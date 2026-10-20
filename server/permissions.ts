import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Grant, GrantsReport } from "../shared/types.js";
import { findApps, getQuick } from "./apps.js";
import { lastUsed } from "./cleanup.js";
import { pool, run } from "./run.js";

// macOS records every privacy decision in two TCC databases: yours, and the system's.
const DBS: [string, Grant["scope"]][] = [
  [path.join(os.homedir(), "Library", "Application Support", "com.apple.TCC", "TCC.db"), "user"],
  ["/Library/Application Support/com.apple.TCC/TCC.db", "system"],
];

export const SERVICE_LABELS: Record<string, string> = {
  Camera: "Camera",
  Microphone: "Microphone",
  ScreenCapture: "Screen recording",
  Accessibility: "Accessibility (control your Mac)",
  ListenEvent: "Input monitoring (sees your keystrokes)",
  PostEvent: "Sends keystrokes and clicks",
  SystemPolicyAllFiles: "Full Disk Access",
  SystemPolicyDesktopFolder: "Desktop folder",
  SystemPolicyDocumentsFolder: "Documents folder",
  SystemPolicyDownloadsFolder: "Downloads folder",
  SystemPolicyNetworkVolumes: "Network drives",
  SystemPolicyRemovableVolumes: "Removable drives",
  AppleEvents: "Automation (controls other apps)",
  AddressBook: "Contacts",
  Calendar: "Calendars",
  Reminders: "Reminders",
  Photos: "Photos",
  PhotosAdd: "Add to Photos",
  MediaLibrary: "Music and media library",
  SpeechRecognition: "Speech recognition",
  BluetoothAlways: "Bluetooth",
  DeveloperTool: "Developer tool",
  FocusStatus: "Focus status",
  AudioCapture: "System audio recording",
  Ubiquity: "iCloud",
  UserTracking: "Tracking across apps and websites",
  FileProviderDomain: "File provider access",
  WebBrowserPublicKeyCredential: "Passkeys",
};

// Internal services macOS uses for its own plumbing; they mean nothing to a person.
const INTERNAL = new Set(["Liverpool", "FileProviderPresence", "SystemPolicySysAdminFiles", "MSO", "Willow", "ShareKit"]);

const SQL = "select service, client, client_type, auth_value, last_modified from access";

interface Row {
  service: string;
  client: string;
  client_type: number;
  auth_value: number;
  last_modified: number;
}

export const diagnostics: Record<string, string> = {};

// Ask sqlite3 directly first. If macOS blocks that helper but allows the engine itself, copy the
// database (and its write-ahead log) somewhere private and read the copy instead.
async function query(db: string) {
  const direct = await run("/usr/bin/sqlite3", ["-readonly", "-json", db, SQL], 8_000);
  diagnostics[`${db} via sqlite3`] = direct.ok ? "ok" : direct.stderr.trim().split("\n")[0] || "failed";
  if (direct.ok) return direct;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "teardown-tcc-"));
  try {
    for (const ext of ["", "-wal", "-shm"]) {
      await fs.copyFile(db + ext, path.join(dir, "TCC.db" + ext)).catch((e: NodeJS.ErrnoException) => {
        if (ext === "") throw e;
      });
    }
    diagnostics[`${db} via engine copy`] = "ok";
    return await run("/usr/bin/sqlite3", ["-readonly", "-json", path.join(dir, "TCC.db"), SQL], 8_000);
  } catch (e) {
    diagnostics[`${db} via engine copy`] = (e as Error).message;
    return direct;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function readGrants(): Promise<GrantsReport> {
  const apps = await findApps();
  const quick = await pool(apps, 4, (a) => getQuick(a.path).catch(() => undefined));
  const byId = new Map<string, { name: string; path: string; bundleId?: string }>();
  quick.forEach((q, i) => q?.bundleId && byId.set(q.bundleId, { name: q.name, path: apps[i].path, bundleId: q.bundleId }));
  const byPath = (client: string) => {
    const i = client.indexOf(".app/");
    const app = i >= 0 ? client.slice(0, i + 4) : undefined;
    const hit = app && apps.find((a) => a.path === app);
    return hit ? { name: hit.name, path: hit.path } : undefined;
  };

  const grants: Grant[] = [];
  let readable = false;
  let reason: string | undefined;
  for (const [db, scope] of DBS) {
    const r = await query(db);
    if (!r.ok) {
      const detail = r.stderr.trim().split("\n")[0];
      reason = /authorization denied|unable to open|not permitted/i.test(r.stderr)
        ? `Teardown needs Full Disk Access to read the permissions you've granted. macOS said: ${detail}`
        : detail;
      continue;
    }
    readable = true;
    let rows: Row[] = [];
    try {
      rows = r.stdout.trim() ? (JSON.parse(r.stdout) as Row[]) : [];
    } catch {}
    for (const row of rows) {
      const app = row.client_type === 0 ? byId.get(row.client) : byPath(row.client);
      if (!app) continue;
      const service = row.service.replace(/^kTCCService/, "");
      if (INTERNAL.has(service)) continue;
      grants.push({
        service,
        label: SERVICE_LABELS[service] ?? service.replace(/([a-z])([A-Z])/g, "$1 $2"),
        client: row.client,
        app: { name: app.name, path: app.path },
        allowed: row.auth_value === 2 || row.auth_value === 3,
        since: row.last_modified ? row.last_modified * 1000 : undefined,
        scope,
      });
    }
  }

  // When each app last did anything, so stale grants are easy to spot.
  const used = new Map<string, number | undefined>();
  await pool([...new Set(grants.map((g) => g.app!.path))], 4, async (p) => {
    const id = [...byId.values()].find((a) => a.path === p)?.bundleId;
    used.set(p, await lastUsed(p, id, path.basename(p, ".app")));
  });
  for (const g of grants) g.lastUsed = used.get(g.app!.path);
  grants.sort((a, b) => a.label.localeCompare(b.label) || a.app!.name.localeCompare(b.app!.name));
  return { readable, reason: readable ? undefined : reason, grants };
}

// tccutil is Apple's own tool for this; resetting means the app has to ask again next time.
export async function revoke(service: string, client: string) {
  if (!/^[A-Za-z]+$/.test(service)) throw new Error("Unknown permission.");
  const report = await readGrants();
  const grant = report.grants.find((g) => g.service === service && g.client === client);
  if (report.readable && !grant) throw new Error("That permission isn't granted.");
  const bundleId = client;
  if (!/^[A-Za-z0-9.-]+$/.test(bundleId)) throw new Error("Only apps with a bundle identifier can be reset.");
  const r = await run("tccutil", ["reset", service, bundleId], 10_000);
  if (!r.ok) throw new Error(r.stderr.trim() || "tccutil couldn't reset it.");
  const after = await readGrants();
  const still = after.readable && after.grants.some((g) => g.service === service && g.client === client && g.allowed);
  return { ok: !still, stillGranted: still, note: still ? "macOS kept this one. System-level permissions can need an administrator; revoke it in System Settings." : undefined };
}
