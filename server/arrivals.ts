import { watch, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Arrival } from "../shared/types.js";
import { getFull } from "./apps.js";
import { moveToTrash } from "./cleanup.js";
import { notify } from "./notices.js";
import { ARRIVALS_FILE } from "./paths.js";
import { run } from "./run.js";
import { getSettings, readJson, writeJson } from "./store.js";

const HOME = os.homedir();
const PLACES = ["/Applications", path.join(HOME, "Applications"), path.join(HOME, "Downloads")];

// macOS tags downloaded apps with com.apple.quarantine. Flag 0x40 is set once you open the app,
// so a tag without it means the app has arrived but never run.
async function quarantine(app: string) {
  const r = await run("xattr", ["-p", "com.apple.quarantine", app], 3_000);
  if (!r.ok) return undefined;
  const [flags, stamp, agent] = r.stdout.trim().split(";");
  const f = parseInt(flags, 16);
  if (!Number.isFinite(f)) return undefined;
  return { opened: (f & 0x40) !== 0, at: parseInt(stamp, 16) * 1000 || undefined, agent: agent || undefined };
}

async function whereFrom(app: string): Promise<string[] | undefined> {
  const r = await run("mdls", ["-raw", "-name", "kMDItemWhereFroms", app], 3_000);
  const urls = [...r.stdout.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((u) => /^https?:/.test(u));
  return urls.length ? urls : undefined;
}

async function candidates(): Promise<string[]> {
  const out: string[] = [];
  for (const dir of PLACES) {
    for (const n of await fs.readdir(dir).catch(() => [] as string[])) {
      const p = path.join(dir, n);
      if (n.endsWith(".app")) out.push(p);
      else if (!n.startsWith(".") && dir === "/Applications") {
        for (const inner of await fs.readdir(p).catch(() => [] as string[])) if (inner.endsWith(".app")) out.push(path.join(p, inner));
      }
    }
  }
  return out;
}

let current: Arrival[] = [];
let scanning: Promise<Arrival[]> | undefined;

export const arrivals = () => current;

export function scanArrivals(): Promise<Arrival[]> {
  scanning ??= (async () => {
    const hidden = new Set((await getSettings()).hiddenApps);
    const found: Arrival[] = [];
    for (const app of await candidates()) {
      if (hidden.has(app)) continue;
      const q = await quarantine(app);
      if (!q || q.opened) continue;
      const report = await getFull(app).catch(() => undefined);
      found.push({
        path: app,
        name: report?.name ?? path.basename(app, ".app"),
        bundleId: report?.bundleId,
        version: report?.version,
        source: q.agent,
        from: await whereFrom(app),
        quarantinedAt: q.at,
        stack: report?.stack,
        stackLabel: report?.stackLabel,
        findings: report?.findings.slice(0, 5) ?? [],
        verdict: report?.verdict[0],
      });
    }
    current = found;

    const seen = new Set(await readJson<string[]>(ARRIVALS_FILE, []));
    const fresh = found.filter((a) => !seen.has(`${a.path}:${a.quarantinedAt}`));
    if (fresh.length && (await getSettings()).notifyArrivals) {
      for (const a of fresh) {
        const worst = a.findings.find((f) => f.severity === "notable");
        await notify({
          kind: "arrival",
          title: `${a.name} hasn't been opened yet`,
          body: worst ? `Teardown read it first: ${worst.title.toLowerCase()}.` : "Teardown read it first. Nothing stood out.",
          target: "#/changes",
          severity: worst ? "notable" : "info",
        });
      }
    }
    await writeJson(ARRIVALS_FILE, [...new Set([...seen, ...found.map((a) => `${a.path}:${a.quarantinedAt}`)])].slice(-500));
    return found;
  })().finally(() => {
    scanning = undefined;
  });
  return scanning;
}

// React to new downloads and installs within seconds instead of waiting for the next check.
export function watchArrivals() {
  let t: NodeJS.Timeout | undefined;
  const kick = () => {
    clearTimeout(t);
    t = setTimeout(() => scanArrivals().catch(() => {}), 4_000);
  };
  for (const dir of PLACES) {
    try {
      watch(dir, kick);
    } catch {}
  }
  kick();
}

function arrival(p: unknown) {
  return current.find((a) => a.path === p);
}

export async function openArrival(p: unknown) {
  const a = arrival(p);
  if (!a) throw new Error("That app isn't waiting to be opened.");
  await run("open", [a.path], 5_000);
  setTimeout(() => scanArrivals().catch(() => {}), 5_000);
}

export async function trashArrival(p: unknown) {
  const a = arrival(p);
  if (!a) throw new Error("That app isn't waiting to be opened.");
  await moveToTrash(a.path);
  current = current.filter((x) => x !== a);
}
