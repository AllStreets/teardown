import { promises as dns } from "node:dns";
import path from "node:path";
import type { Connection, LiveApp, LiveSnapshot, SelfConnections } from "../shared/types.js";
import { cachedFull } from "./apps.js";
import { PORT } from "./paths.js";
import { run } from "./run.js";
import { getSettings } from "./store.js";

interface Socket {
  pid: number;
  command: string;
  protocol: string;
  name: string;
  state?: string;
}

// lsof only sees processes owned by this user, which is every app you opened.
async function sockets(): Promise<Socket[]> {
  const r = await run("lsof", ["-i", "-n", "-P", "-F", "pcPnT", "+c", "0"], 10_000);
  const out: Socket[] = [];
  let pid = 0;
  let command = "";
  let cur: Partial<Socket> | null = null;
  const flush = () => {
    if (cur?.name && cur.protocol) out.push({ pid, command, protocol: cur.protocol, name: cur.name, state: cur.state });
    cur = null;
  };
  for (const line of r.stdout.split("\n")) {
    const tag = line[0];
    const val = line.slice(1);
    if (tag === "p") {
      flush();
      pid = Number(val);
    } else if (tag === "c") command = val;
    else if (tag === "f") {
      flush();
      cur = {};
    } else if (tag === "P" && cur) cur.protocol = val;
    else if (tag === "n" && cur) cur.name = val;
    else if (tag === "T" && cur && val.startsWith("ST=")) cur.state = val.slice(3);
  }
  flush();
  return out;
}

async function processPaths(): Promise<Map<number, string>> {
  const r = await run("ps", ["-axww", "-o", "pid=,comm="], 5_000);
  const m = new Map<number, string>();
  for (const line of r.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (match) m.set(Number(match[1]), match[2]);
  }
  return m;
}

// Helper processes live inside the main bundle; attribute them to the outermost app.
export function appOf(exe: string): string | undefined {
  const i = exe.indexOf(".app/");
  if (i < 0) return exe.endsWith(".app") ? exe : undefined;
  return exe.slice(0, i + 4);
}

function splitEndpoint(s: string): { host: string; port: number } {
  const m = s.match(/^\[?([^\]]+?)\]?:(\d+|\*)$/);
  return m ? { host: m[1], port: m[2] === "*" ? 0 : Number(m[2]) } : { host: s, port: 0 };
}

const ptrCache = new Map<string, { host?: string; at: number }>();
async function reverse(ip: string): Promise<string | undefined> {
  const hit = ptrCache.get(ip);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.host;
  const host = await Promise.race([
    dns.reverse(ip).then((h) => h[0], () => undefined),
    new Promise<undefined>((r) => setTimeout(() => r(undefined), 1200)),
  ]);
  ptrCache.set(ip, { host, at: Date.now() });
  return host;
}

const registrable = (host: string) => host.split(".").slice(-2).join(".");

// Resolve the domains an app's code mentions, so live connections can be matched by address.
const fwdCache = new Map<string, { ips: string[]; at: number }>();
async function resolveAll(domains: string[]): Promise<Map<string, string>> {
  const byIp = new Map<string, string>();
  await Promise.all(domains.slice(0, 80).map(async (d) => {
    let hit = fwdCache.get(d);
    if (!hit || Date.now() - hit.at > 10 * 60_000) {
      const ips = await Promise.race([
        dns.lookup(d, { all: true }).then((r) => r.map((x) => x.address), () => [] as string[]),
        new Promise<string[]>((r) => setTimeout(() => r([]), 1500)),
      ]);
      hit = { ips, at: Date.now() };
      fwdCache.set(d, hit);
    }
    for (const ip of hit.ips) if (!byIp.has(ip)) byIp.set(ip, d);
  }));
  return byIp;
}
const isLocal = (ip: string) => /^(127\.|::1$|localhost|0\.0\.0\.0|\*$|fe80:)/.test(ip);

function toConnections(list: Socket[]) {
  const connections: Omit<Connection, "host" | "mentioned">[] = [];
  const listening = new Set<string>();
  for (const s of list) {
    const [local, remote] = s.name.split("->");
    if (!remote) {
      if (s.state === "LISTEN") listening.add(`${s.protocol} port ${splitEndpoint(local).port}`);
      continue;
    }
    const r = splitEndpoint(remote);
    if (isLocal(r.host)) continue;
    connections.push({ remote: r.host, port: r.port, protocol: s.protocol, state: s.state, process: s.command });
  }
  return { connections, listening: [...listening] };
}

let last: { at: number; data: LiveSnapshot } | undefined;

export async function liveConnections(): Promise<LiveSnapshot> {
  if (last && Date.now() - last.at < 2_500) return last.data;
  last = undefined;
  const [socks, paths] = await Promise.all([sockets(), processPaths()]);
  const hidden = new Set((await getSettings()).hiddenApps);
  const byApp = new Map<string, Socket[]>();
  for (const s of socks) {
    const exe = paths.get(s.pid);
    const app = exe && appOf(exe);
    if (!app || hidden.has(app)) continue;
    byApp.set(app, [...(byApp.get(app) ?? []), s]);
  }

  const apps: LiveApp[] = [];
  for (const [app, list] of byApp) {
    const { connections, listening } = toConnections(list);
    if (!connections.length && !listening.length) continue;
    const report = await cachedFull(app);
    const codeDomains = (report?.domains ?? []).map((d) => d.host);
    const mentioned = new Set(codeDomains.map(registrable));
    const known = report ? await resolveAll(codeDomains) : new Map<string, string>();
    // One row per remote endpoint; many sockets to the same server collapse.
    const seen = new Map<string, Connection>();
    for (const c of connections) {
      const key = `${c.remote}:${c.port}`;
      if (seen.has(key)) continue;
      const byAddress = known.get(c.remote);
      const host = byAddress ?? (await reverse(c.remote));
      seen.set(key, { ...c, host, mentioned: report ? !!byAddress || (!!host && mentioned.has(registrable(host))) : undefined });
    }
    apps.push({
      path: app,
      name: report?.name ?? path.basename(app, ".app"),
      pids: [...new Set(list.map((s) => s.pid))],
      connections: [...seen.values()],
      listening,
      mentionedTotal: report?.domains.length,
    });
  }
  apps.sort((a, b) => b.connections.length - a.connections.length || a.name.localeCompare(b.name));
  const data = { apps, at: Date.now() };
  last = { at: Date.now(), data };
  return data;
}

// Teardown audits itself with the same engine it uses on every other app.
export async function selfConnections(): Promise<SelfConnections> {
  const socks = (await sockets()).filter((s) => s.pid === process.pid);
  const { connections, listening } = toConnections(socks);
  return {
    pid: process.pid,
    port: PORT,
    outbound: connections.map((c) => ({ ...c })),
    listening,
    checkedAt: Date.now(),
  };
}
