// Teardown as an MCP server: lets an AI agent ask what's on this Mac and, with your approval,
// act on it. Every answer comes from the running Teardown engine, which reads real files.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { AppEntry, Arrival, ChangeEvent, CleanupScan, GrantsReport, LiveSnapshot, QuickReport, Report, SavedVersion } from "../shared/types.js";

const ENGINE = `http://127.0.0.1:${process.env.TEARDOWN_PORT ?? 4710}`;

async function get<T>(path: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(ENGINE + path);
  } catch {
    throw new Error("Teardown isn't running. Open the Teardown app (or run `npm run dev`) and try again.");
  }
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Engine returned ${r.status}`);
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(ENGINE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Engine returned ${r.status}`);
  return (r.status === 204 ? undefined : r.json()) as Promise<T>;
}

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const q = encodeURIComponent;

// Accepts a name like "slack" or a full path, and finds the installed app it means.
async function resolve(app: string): Promise<AppEntry> {
  const apps = await get<AppEntry[]>("/api/apps");
  const lower = app.toLowerCase().replace(/\.app$/, "");
  const hit = apps.find((a) => a.path === app) ?? apps.find((a) => a.name.toLowerCase() === lower) ?? apps.find((a) => a.name.toLowerCase().includes(lower));
  if (!hit) throw new Error(`No installed app matches "${app}".`);
  return hit;
}

const server = new McpServer({ name: "teardown", version: "0.3.0" });

server.registerTool("list_apps", {
  description: "List the apps installed on this Mac with how each is built (Electron, SwiftUI, Qt...), its size, and whether it's sandboxed. Optionally filter by stack or name.",
  inputSchema: { stack: z.string().optional().describe("e.g. electron, swiftui, chromium, qt"), query: z.string().optional() },
}, async ({ stack, query }) => {
  const apps = (await get<AppEntry[]>("/api/apps")).filter((a) => !query || a.name.toLowerCase().includes(query.toLowerCase()));
  const rows = [];
  for (const a of apps) {
    const r = await get<QuickReport>(`/api/quick?path=${q(a.path)}`).catch(() => undefined);
    if (!r || (stack && r.stack !== stack.toLowerCase())) continue;
    rows.push({ name: r.name, stack: r.stackLabel, version: r.version, sizeMB: Math.round(r.sizeBytes / 1e6), sandboxed: r.sandboxed, path: a.path });
  }
  return text(rows);
});

server.registerTool("get_app", {
  description: "Full teardown of one app: plain-English verdict, notable findings with evidence, signing, permissions it can ask for, entitlements, tracking SDKs and web addresses in its code.",
  inputSchema: { app: z.string().describe("App name or path, e.g. Slack") },
}, async ({ app }) => {
  const a = await resolve(app);
  const r = await get<Report>(`/api/teardown?path=${q(a.path)}`);
  return text({
    name: r.name, version: r.version, stack: r.stackLabel, verdict: r.verdict.join(" "),
    findings: r.findings.map((f) => ({ severity: f.severity, title: f.title, detail: f.detail, evidence: f.evidence })),
    signing: r.signing, permissionsItCanAskFor: r.permissions.map((p) => ({ permission: p.label, reason: p.reason })),
    riskyEntitlements: r.entitlements.filter((e) => e.risky).map((e) => e.label ?? e.key),
    sdks: r.sdks, webAddresses: r.domains.slice(0, 40).map((d) => d.host), electron: r.electron,
  });
});

server.registerTool("granted_permissions", {
  description: "What the person has actually allowed apps to do (camera, microphone, screen recording, accessibility, full disk access...), read from macOS's permission records, with when each app was last active.",
  inputSchema: { permission: z.string().optional().describe("Filter, e.g. microphone or screen"), app: z.string().optional() },
}, async ({ permission, app }) => {
  const r = await get<GrantsReport>("/api/permissions");
  if (!r.readable) return text(r.reason ?? "Teardown can't read permission records; it needs Full Disk Access.");
  const rows = r.grants
    .filter((g) => g.allowed)
    .filter((g) => !permission || g.label.toLowerCase().includes(permission.toLowerCase()) || g.service.toLowerCase().includes(permission.toLowerCase()))
    .filter((g) => !app || g.app?.name.toLowerCase().includes(app.toLowerCase()))
    .map((g) => ({ app: g.app?.name, permission: g.label, service: g.service, client: g.client, lastActive: g.lastUsed ? new Date(g.lastUsed).toISOString().slice(0, 10) : null }));
  return text(rows);
});

server.registerTool("recent_changes", {
  description: "What changed underneath recent app updates: new trackers, new permission requests, signer changes, dropped sandboxes, new frameworks.",
  inputSchema: { limit: z.number().int().min(1).max(50).optional() },
}, async ({ limit }) => {
  const r = await get<{ events: ChangeEvent[] }>("/api/changes");
  return text(r.events.slice(0, limit ?? 10).map((e) => ({ app: e.name, from: e.from, to: e.to, detected: new Date(e.detectedAt).toISOString(), changes: e.changes })));
});

server.registerTool("live_connections", {
  description: "Apps with open internet connections right now, and whether each connection goes to an address written in that app's own code.",
  inputSchema: {},
}, async () => {
  const r = await get<LiveSnapshot>("/api/live");
  return text(r.apps.filter((a) => a.connections.length).map((a) => ({ app: a.name, connections: a.connections.map((c) => ({ host: c.host ?? c.remote, port: c.port, inItsCode: c.mentioned ?? null })) })));
});

server.registerTool("not_yet_opened", {
  description: "Apps that were downloaded but have never been opened, with what Teardown found inside them before their first launch.",
  inputSchema: {},
}, async () => text((await get<Arrival[]>("/api/arrivals")).map((a) => ({ app: a.name, version: a.version, downloadedWith: a.source, from: a.from, verdict: a.verdict, findings: a.findings.map((f) => f.title) }))));

server.registerTool("cleanup_summary", {
  description: "Space that could be freed: rebuildable caches, apps unused for months, leftovers from deleted apps, broken login items. Read-only.",
  inputSchema: {},
}, async () => {
  const r = await get<CleanupScan>("/api/cleanup");
  return text(r.items.filter((i) => i.removable).slice(0, 40).map((i) => ({ category: i.category, item: i.label, sizeMB: Math.round(i.bytes / 1e6), detail: i.detail })));
});

server.registerTool("revoke_permission", {
  description: "Take back a permission from an app using Apple's tccutil; the app has to ask again next time. Only call this after the person has clearly agreed, and pass confirm: true.",
  inputSchema: { app: z.string(), permission: z.string().describe("e.g. Microphone, Camera, ScreenCapture"), confirm: z.literal(true) },
  annotations: { destructiveHint: true },
}, async ({ app, permission }) => {
  const a = await resolve(app);
  const r = await get<GrantsReport>("/api/permissions");
  const g = r.grants.find((x) => x.allowed && x.app?.path === a.path && (x.service.toLowerCase() === permission.toLowerCase() || x.label.toLowerCase().includes(permission.toLowerCase())));
  if (!g) return text(`${a.name} doesn't currently have ${permission}.`);
  const res = await post<{ ok: boolean; note?: string }>("/api/permissions/revoke", { service: g.service, client: g.client });
  return text(res.ok ? `Took ${g.label} back from ${a.name}.` : res.note ?? "macOS kept the permission.");
});

server.registerTool("rollback_app", {
  description: "Roll an app back to the version Teardown saved before its latest update. The current version goes to the Trash. The app must be closed. Only call after the person agrees, with confirm: true.",
  inputSchema: { app: z.string(), confirm: z.literal(true) },
  annotations: { destructiveHint: true },
}, async ({ app }) => {
  const a = await resolve(app);
  const versions = await get<SavedVersion[]>(`/api/versions?path=${q(a.path)}`);
  const target = versions.find((v) => !v.current);
  if (!target) return text(`Teardown has no earlier saved version of ${a.name}.`);
  const r = await post<{ version?: string }>("/api/rollback", { path: a.path, savedAt: target.savedAt });
  return text(`${a.name} is back on ${r.version ?? "the earlier version"}. The newer version is in the Trash.`);
});

await server.connect(new StdioServerTransport());
