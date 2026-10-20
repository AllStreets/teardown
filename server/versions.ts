import { promises as fs } from "node:fs";
import path from "node:path";
import type { SavedVersion } from "../shared/types.js";
import { cacheKey } from "./apps.js";
import { moveToTrash, runningApps } from "./cleanup.js";
import { notify } from "./notices.js";
import { VERSIONS_DIR } from "./paths.js";
import { readPlist, run } from "./run.js";
import { getSettings, readJson, writeJson } from "./store.js";

// Copies are APFS clones: they share every block with the installed app until it changes, so a
// saved version costs nothing until the app updates. They're stored under a non-.app name so
// macOS never offers them as duplicate apps.
const EXT = ".teardownversion";
const KEEP = 3;

interface Meta {
  version?: string;
  savedAt: number;
  stamp: number;
  source: string;
}

const dirFor = (app: string) => path.join(VERSIONS_DIR, cacheKey(app));

async function metas(app: string): Promise<Meta[]> {
  const dir = dirFor(app);
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json"));
  const list = await Promise.all(files.map((f) => readJson<Meta | null>(path.join(dir, f), null)));
  return (list.filter(Boolean) as Meta[]).sort((a, b) => b.savedAt - a.savedAt);
}

async function ensureRoot() {
  await fs.mkdir(VERSIONS_DIR, { recursive: true });
  // Keep Spotlight out, so the copies never show up in searches.
  await fs.writeFile(path.join(VERSIONS_DIR, ".metadata_never_index"), "").catch(() => {});
}

export async function saveVersion(app: string, version: string | undefined, stamp: number) {
  if (!(await getSettings()).keepVersions) return;
  if (app.startsWith("/System/")) return;
  const existing = await metas(app);
  if (existing[0]?.stamp === stamp) return;
  await ensureRoot();
  const dir = dirFor(app);
  await fs.mkdir(dir, { recursive: true });
  const savedAt = Date.now();
  const dest = path.join(dir, `${savedAt}${EXT}`);
  const r = await run("cp", ["-c", "-R", "-p", app, dest], 120_000);
  if (!r.ok) {
    await fs.rm(dest, { recursive: true, force: true });
    return;
  }
  await writeJson(path.join(dir, `${savedAt}.json`), { version, savedAt, stamp, source: app } satisfies Meta);
  for (const old of existing.slice(KEEP - 1)) {
    await fs.rm(path.join(dir, `${old.savedAt}${EXT}`), { recursive: true, force: true });
    await fs.rm(path.join(dir, `${old.savedAt}.json`), { force: true });
  }
}

async function currentVersion(app: string) {
  const info = await readPlist(path.join(app, "Contents", "Info.plist"));
  return (info?.CFBundleShortVersionString as string | undefined) ?? (info?.CFBundleVersion as string | undefined);
}

export async function listVersions(app: string): Promise<SavedVersion[]> {
  const cur = await currentVersion(app);
  return (await metas(app)).map((m, i) => ({
    version: m.version,
    savedAt: m.savedAt,
    path: path.join(dirFor(app), `${m.savedAt}${EXT}`),
    current: i === 0 && m.version === cur,
  }));
}

export async function rollback(app: string, savedAt: number) {
  const meta = (await metas(app)).find((m) => m.savedAt === savedAt);
  if (!meta) throw new Error("That version isn't saved anymore.");
  if ((await runningApps()).has(app)) throw new Error("Quit the app first, then roll back.");
  const clone = path.join(dirFor(app), `${savedAt}${EXT}`);
  const staged = `${app.replace(/\.app$/, "")} (restoring).app`;
  // Stage the old version next to the app first, so nothing is lost if a step fails.
  await fs.rm(staged, { recursive: true, force: true });
  const r = await run("cp", ["-c", "-R", "-p", clone, staged], 120_000);
  if (!r.ok) throw new Error(`Couldn't restore the saved copy: ${r.stderr.trim() || "copy failed"}`);
  try {
    await moveToTrash(app);
  } catch (e) {
    await fs.rm(staged, { recursive: true, force: true });
    throw e;
  }
  await fs.rename(staged, app);
  await run("touch", [app], 5_000);
  await notify({
    kind: "rollback",
    title: `${path.basename(app, ".app")} is back on ${meta.version ?? "the earlier version"}`,
    body: "The newer version is in the Trash if you change your mind.",
    target: `#/app/${encodeURIComponent(app)}`,
    severity: "good",
  });
  return { version: meta.version };
}

export async function versionStorage() {
  const dirs = await fs.readdir(VERSIONS_DIR).catch(() => [] as string[]);
  let copies = 0;
  for (const d of dirs) copies += (await fs.readdir(path.join(VERSIONS_DIR, d)).catch(() => [] as string[])).filter((f) => f.endsWith(EXT)).length;
  return { apps: dirs.filter((d) => !d.startsWith(".")).length, copies };
}
