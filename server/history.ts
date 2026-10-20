import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Change, ChangeEvent, Fingerprint, Report, WatchStatus } from "../shared/types.js";
import { cacheKey, findApps, getFull, stamp } from "./apps.js";
import { TRACKING } from "./knowledge.js";
import { CHANGES_FILE, SNAPSHOT_DIR } from "./paths.js";
import { getSettings, readJson, writeJson } from "./store.js";

// Bump whenever analysis changes in a way that would alter a snapshot of an unchanged app.
export const ENGINE = 2;

export function fingerprint(r: Report, s: number): Fingerprint {
  return {
    engine: ENGINE,
    path: r.path,
    name: r.name,
    bundleId: r.bundleId,
    version: r.version,
    stamp: s,
    takenAt: Date.now(),
    stack: r.stack,
    stackLabel: r.stackLabel,
    archs: r.archs,
    sizeBytes: r.sizeBytes,
    sandboxed: r.sandboxed,
    teamId: r.signing.teamId,
    authority: r.signing.authority,
    notarized: r.signing.notarized,
    hardenedRuntime: r.signing.hardenedRuntime,
    electron: r.electron?.version,
    chromium: r.electron?.chromium,
    sdks: r.sdks.map((x) => ({ name: x.name, category: x.category })),
    permissions: r.permissions.map((p) => ({ label: p.label, reason: p.reason })),
    entitlements: r.entitlements.map((e) => ({ key: e.key, label: e.label, risky: e.risky })),
    frameworks: r.frameworks.map((f) => ({ name: f.name, size: f.size })),
    npm: r.npm?.packages.map((p) => ({ name: p.name, version: p.version })) ?? [],
    domains: r.domains.map((d) => d.host),
  };
}

function mb(n: number) {
  return `${Math.round(Math.abs(n) / 1e6)} MB`;
}

function names(list: string[], max = 4) {
  const shown = list.slice(0, max).join(", ");
  return list.length > max ? `${shown} and ${list.length - max} more` : shown;
}

// Compares two versions of the same app and says what changed underneath.
export function diff(a: Fingerprint, b: Fingerprint): Change[] {
  const out: Change[] = [];
  const add = (severity: Change["severity"], title: string, detail?: string) => out.push({ severity, title, detail });

  if (a.teamId && b.teamId && a.teamId !== b.teamId) {
    add("notable", "Signed by a different developer", `The signing team changed from ${a.teamId} to ${b.teamId}. Legitimate apps almost never do this.`);
  }
  if (a.notarized && b.notarized === false) add("notable", "No longer notarized", "Apple's malware check no longer covers this build.");
  if (a.hardenedRuntime && !b.hardenedRuntime) add("notable", "Hardened runtime switched off");
  if (!a.hardenedRuntime && b.hardenedRuntime) add("good", "Hardened runtime switched on");
  if (a.sandboxed && !b.sandboxed) add("notable", "Left the App Sandbox", "It can now reach far more of your files without asking.");
  if (!a.sandboxed && b.sandboxed) add("good", "Moved into the App Sandbox");

  const before = new Map(a.sdks.map((s) => [s.name, s]));
  const after = new Map(b.sdks.map((s) => [s.name, s]));
  for (const [n, s] of after) {
    if (before.has(n)) continue;
    add(TRACKING.includes(s.category) ? "notable" : "info", `Added ${n}`, `A new ${s.category} SDK ships in this version.`);
  }
  for (const [n, s] of before) {
    if (after.has(n)) continue;
    add(TRACKING.includes(s.category) ? "good" : "info", `Removed ${n}`, `The ${s.category} SDK is gone.`);
  }

  const pa = new Map(a.permissions.map((p) => [p.label, p.reason]));
  const pb = new Map(b.permissions.map((p) => [p.label, p.reason]));
  for (const [label, reason] of pb) {
    if (!pa.has(label)) add("notable", `Can now ask for ${label.toLowerCase()}`, `"${reason}"`);
    else if (pa.get(label) !== reason) add("info", `Reworded its ${label.toLowerCase()} request`, `"${pa.get(label)}" became "${reason}"`);
  }
  for (const [label] of pa) if (!pb.has(label)) add("good", `No longer asks for ${label.toLowerCase()}`);

  const ea = new Map(a.entitlements.map((e) => [e.key, e]));
  const eb = new Map(b.entitlements.map((e) => [e.key, e]));
  const newEnts = [...eb.values()].filter((e) => !ea.has(e.key));
  for (const e of newEnts.filter((e) => e.risky)) add("notable", `New entitlement: ${e.label ?? e.key}`, e.key);
  const quiet = newEnts.filter((e) => !e.risky);
  if (quiet.length) add("info", `${quiet.length} new entitlement${quiet.length === 1 ? "" : "s"}`, names(quiet.map((e) => e.label ?? e.key)));
  const gone = [...ea.values()].filter((e) => !eb.has(e.key));
  if (gone.length) add(gone.some((e) => e.risky) ? "good" : "info", `Dropped ${gone.length} entitlement${gone.length === 1 ? "" : "s"}`, names(gone.map((e) => e.label ?? e.key)));

  if (!a.archs.includes("arm64") && b.archs.includes("arm64")) add("good", "Now runs natively on Apple silicon");
  if (a.archs.includes("arm64") && !b.archs.includes("arm64")) add("notable", "Dropped native Apple silicon support");

  if (a.stack !== b.stack) add("info", `Rebuilt on ${b.stackLabel}`, `It used to be built with ${a.stackLabel}.`);
  if (a.electron && b.electron && a.electron !== b.electron) add("info", `Electron ${a.electron} to ${b.electron}`);
  if (a.chromium && b.chromium && a.chromium.split(".")[0] !== b.chromium.split(".")[0]) {
    add("info", `Chromium ${a.chromium.split(".")[0]} to ${b.chromium.split(".")[0]}`);
  }

  const fa = new Set(a.frameworks.map((f) => f.name));
  const fb = new Set(b.frameworks.map((f) => f.name));
  const fAdded = [...fb].filter((f) => !fa.has(f));
  const fRemoved = [...fa].filter((f) => !fb.has(f));
  if (fAdded.length) add("info", `Bundles ${fAdded.length} new framework${fAdded.length === 1 ? "" : "s"}`, names(fAdded));
  if (fRemoved.length) add("info", `Removed ${fRemoved.length} framework${fRemoved.length === 1 ? "" : "s"}`, names(fRemoved));

  const na = new Map(a.npm.map((p) => [p.name, p.version]));
  const nb = new Map(b.npm.map((p) => [p.name, p.version]));
  const nAdded = [...nb.keys()].filter((n) => !na.has(n));
  const nRemoved = [...na.keys()].filter((n) => !nb.has(n));
  const nBumped = [...nb.entries()].filter(([n, v]) => na.has(n) && na.get(n) !== v);
  if (nAdded.length) add("info", `${nAdded.length} new npm package${nAdded.length === 1 ? "" : "s"}`, names(nAdded));
  if (nRemoved.length) add("info", `${nRemoved.length} npm package${nRemoved.length === 1 ? "" : "s"} removed`, names(nRemoved));
  if (nBumped.length) add("info", `${nBumped.length} npm package${nBumped.length === 1 ? "" : "s"} updated`, names(nBumped.map(([n, v]) => `${n} ${na.get(n)} to ${v}`)));

  const da = new Set(a.domains);
  const dAdded = b.domains.filter((d) => !da.has(d));
  const db = new Set(b.domains);
  const dRemoved = a.domains.filter((d) => !db.has(d));
  if (dAdded.length) add("info", `Mentions ${dAdded.length} new web address${dAdded.length === 1 ? "" : "es"}`, names(dAdded, 6));
  if (dRemoved.length) add("info", `Stopped mentioning ${dRemoved.length} web address${dRemoved.length === 1 ? "" : "es"}`, names(dRemoved, 6));

  const delta = b.sizeBytes - a.sizeBytes;
  if (Math.abs(delta) > 5e6 && Math.abs(delta) / Math.max(1, a.sizeBytes) > 0.03) {
    add("info", delta > 0 ? `${mb(delta)} bigger` : `${mb(delta)} smaller`, `${mb(a.sizeBytes)} to ${mb(b.sizeBytes)}`);
  }

  const order = { notable: 0, good: 1, info: 2 };
  return out.sort((x, y) => order[x.severity] - order[y.severity]);
}

// ---------- snapshots on disk ----------

const snapDir = (app: string) => path.join(SNAPSHOT_DIR, cacheKey(app));

export async function latestSnapshot(app: string): Promise<Fingerprint | undefined> {
  const dir = snapDir(app);
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) return undefined;
  return readJson<Fingerprint | undefined>(path.join(dir, files[files.length - 1]), undefined);
}

export async function snapshotsFor(app: string): Promise<Fingerprint[]> {
  const dir = snapDir(app);
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(files.map((f) => readJson<Fingerprint>(path.join(dir, f), undefined as never)));
}

async function saveSnapshot(fp: Fingerprint) {
  await writeJson(path.join(snapDir(fp.path), `${fp.takenAt}.json`), fp);
}

export const readChanges = () => readJson<ChangeEvent[]>(CHANGES_FILE, []);

async function recordChange(ev: ChangeEvent) {
  const all = await readChanges();
  all.unshift(ev);
  await writeJson(CHANGES_FILE, all.slice(0, 500));
}

// Called whenever a full report is produced, from any route.
export async function observe(report: Report) {
  const s = await stamp(report.path);
  const prev = await latestSnapshot(report.path);
  if (prev && prev.stamp === s && prev.engine === ENGINE) return;
  const fp = fingerprint(report, s);
  await saveSnapshot(fp);
  // A first snapshot, or one taken by an older engine, becomes the new baseline silently.
  if (!prev || prev.engine !== ENGINE) return;
  const changes = diff(prev, fp);
  if (!changes.length && prev.version === fp.version) return;
  await recordChange({
    id: createHash("sha1").update(`${fp.path}:${fp.takenAt}`).digest("hex").slice(0, 12),
    path: fp.path,
    name: fp.name,
    bundleId: fp.bundleId,
    from: prev.version,
    to: fp.version,
    detectedAt: fp.takenAt,
    changes: changes.length ? changes : [{ severity: "info", title: "Nothing changed underneath", detail: "The version number moved, but the bundle looks the same." }],
  });
}

// ---------- the watcher ----------

const status: WatchStatus = { watching: false, baselined: 0, total: 0, queue: 0 };
let timer: NodeJS.Timeout | undefined;
let running = false;

export const watchStatus = () => ({ ...status });

export async function checkNow() {
  if (running) return;
  running = true;
  try {
    const settings = await getSettings();
    const apps = (await findApps()).filter((a) => settings.includeSystem || a.location !== "system");
    status.total = apps.length;
    status.baselined = 0;
    const todo: string[] = [];
    for (const a of apps) {
      const snap = await latestSnapshot(a.path);
      if (snap && snap.engine === ENGINE && snap.stamp === (await stamp(a.path))) status.baselined++;
      else todo.push(a.path);
    }
    status.queue = todo.length;
    // One at a time keeps the Mac responsive while it reads in the background.
    for (const app of todo) {
      status.current = path.basename(app, ".app");
      try {
        await observe(await getFull(app));
        status.baselined++;
      } catch {}
      status.queue--;
    }
    status.current = undefined;
    status.lastCheck = Date.now();
  } finally {
    running = false;
  }
}

export async function startWatching() {
  if (timer) clearTimeout(timer);
  const settings = await getSettings();
  status.watching = settings.watch;
  if (!settings.watch) {
    status.nextCheck = undefined;
    return;
  }
  const loop = async () => {
    await checkNow().catch(() => {});
    const s = await getSettings();
    status.nextCheck = Date.now() + s.intervalMinutes * 60_000;
    timer = setTimeout(loop, s.intervalMinutes * 60_000);
  };
  timer = setTimeout(loop, 3_000);
}
