import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CleanupItem, CleanupScan, TrashResult } from "../shared/types.js";
import { findApps, getQuick } from "./apps.js";
import { CLEANUP_LOG } from "./paths.js";
import { pool, readPlist, run } from "./run.js";
import { getSettings, readJson, writeJson } from "./store.js";

const HOME = os.homedir();
const LIB = path.join(HOME, "Library");
const TRASH = path.join(HOME, ".Trash");

// Folders where apps leave data named after their bundle identifier.
const LEFTOVER_DIRS: { dir: string; label: string; strip?: RegExp }[] = [
  { dir: "Application Support", label: "app data" },
  { dir: "Caches", label: "cache" },
  { dir: "Containers", label: "sandbox container" },
  { dir: "Preferences", label: "preferences", strip: /\.plist$/ },
  { dir: "Saved Application State", label: "saved window state", strip: /\.savedState$/ },
  { dir: "Logs", label: "logs" },
  { dir: "HTTPStorages", label: "web storage", strip: /\.binarycookies$/ },
  { dir: "WebKit", label: "web data" },
  { dir: "Cookies", label: "cookies", strip: /\.binarycookies$/ },
];

// Rebuildable developer caches; deleting them only costs a slower next build.
const DEV_CACHES: { rel: string; label: string; detail: string }[] = [
  { rel: "Library/Developer/Xcode/DerivedData", label: "Xcode build files", detail: "Xcode rebuilds these the next time you build a project." },
  { rel: "Library/Developer/CoreSimulator/Caches", label: "iOS Simulator caches", detail: "Recreated when the Simulator next runs." },
  { rel: "Library/Caches/Homebrew", label: "Homebrew downloads", detail: "Old installers Homebrew keeps after installing packages." },
  { rel: ".npm/_cacache", label: "npm download cache", detail: "npm downloads packages again when it needs them." },
  { rel: "Library/Caches/pip", label: "pip download cache", detail: "pip downloads packages again when it needs them." },
  { rel: "Library/Caches/Yarn", label: "Yarn download cache", detail: "Yarn downloads packages again when it needs them." },
  { rel: "Library/Caches/CocoaPods", label: "CocoaPods cache", detail: "Recreated on the next pod install." },
  { rel: "Library/Caches/ms-playwright", label: "Playwright browsers", detail: "Test browsers Playwright downloads again on demand." },
];

const BUNDLE_ID = /^[a-z0-9-]+\.[a-z0-9-]+\.[A-Za-z0-9._-]+$/i;
const vendor = (id: string) => id.toLowerCase().split(".").slice(0, 2).join(".");
const idOf = (category: string, p: string) => createHash("sha1").update(`${category}:${p}`).digest("hex").slice(0, 16);

async function du(p: string): Promise<number> {
  const r = await run("du", ["-sk", p], 60_000);
  const kb = parseInt(r.stdout, 10);
  return Number.isFinite(kb) ? kb * 1024 : 0;
}

async function exists(p: string) {
  return fs.access(p).then(() => true, () => false);
}

async function runningApps(): Promise<Set<string>> {
  const r = await run("ps", ["-axww", "-o", "comm="], 5_000);
  const s = new Set<string>();
  for (const line of r.stdout.split("\n")) {
    const i = line.indexOf(".app/");
    if (i >= 0) s.add(line.slice(0, i + 4).trim());
  }
  return s;
}

// Spotlight's last-used date is often missing (migrated Macs, some installers), so fall back
// to the newest write in the app's own data folders. No evidence at all means no verdict.
async function lastUsed(app: string, bundleId?: string, name?: string): Promise<number | undefined> {
  const r = await run("mdls", ["-raw", "-name", "kMDItemLastUsedDate", app], 5_000);
  const spotlight = Date.parse(r.stdout.trim().replace(" +0000", "Z").replace(" ", "T"));
  const places: string[] = [];
  if (bundleId) {
    places.push(
      path.join(LIB, "Containers", bundleId),
      path.join(LIB, "Caches", bundleId),
      path.join(LIB, "Application Support", bundleId),
      path.join(LIB, "Preferences", `${bundleId}.plist`),
      path.join(LIB, "Saved Application State", `${bundleId}.savedState`),
      path.join(LIB, "HTTPStorages", bundleId),
    );
  }
  if (name) places.push(path.join(LIB, "Application Support", name), path.join(LIB, "Caches", name));
  let newest = Number.isFinite(spotlight) ? spotlight : 0;
  for (const p of places) {
    const st = await fs.stat(p).catch(() => undefined);
    if (!st) continue;
    newest = Math.max(newest, st.mtimeMs);
    // A folder's own date only moves when entries are added, so look one level in.
    if (st.isDirectory()) {
      for (const child of (await fs.readdir(p).catch(() => [] as string[])).slice(0, 200)) {
        const cs = await fs.stat(path.join(p, child)).catch(() => undefined);
        if (cs) newest = Math.max(newest, cs.mtimeMs);
      }
    }
  }
  return newest || undefined;
}

let offered = new Map<string, CleanupItem>();

export async function scanCleanup(): Promise<CleanupScan> {
  const t0 = Date.now();
  const settings = await getSettings();
  const apps = await findApps({ includeHidden: true });
  const hidden = new Set(settings.hiddenApps);
  const quick = await pool(apps, 4, (a) => getQuick(a.path).catch(() => undefined));
  const hiddenNames = new Set(apps.map((a, i) => (hidden.has(a.path) ? quick[i]?.name : undefined)).filter(Boolean) as string[]);
  const installed = new Map<string, string>();
  for (const q of quick) if (q?.bundleId) installed.set(q.bundleId.toLowerCase(), q.name);
  const vendors = new Map<string, string>();
  for (const [id, name] of installed) vendors.set(vendor(id), name);

  const ownerOf = (id: string) => {
    const lower = id.toLowerCase();
    for (const [inst, name] of installed) if (lower === inst || lower.startsWith(inst + ".") || inst.startsWith(lower + ".")) return name;
    return undefined;
  };

  const items: CleanupItem[] = [];
  const candidates: Omit<CleanupItem, "bytes">[] = [];

  // Leftovers: data for bundle identifiers no installed app (or its vendor) claims.
  for (const { dir, label, strip } of LEFTOVER_DIRS) {
    const base = path.join(LIB, dir);
    for (const name of await fs.readdir(base).catch(() => [] as string[])) {
      const id = strip ? name.replace(strip, "") : name;
      if (!BUNDLE_ID.test(id) || id.toLowerCase().startsWith("com.apple.")) continue;
      const owner = ownerOf(id);
      const p = path.join(base, name);
      if (!owner && !vendors.has(vendor(id))) {
        candidates.push({ id: idOf("leftovers", p), category: "leftovers", path: p, label: id, detail: `${label[0].toUpperCase()}${label.slice(1)} left by an app that's no longer installed.`, removable: true, owner: id });
      } else if (owner && dir === "Caches") {
        candidates.push({ id: idOf("caches", p), category: "caches", path: p, label: `${owner} cache`, detail: `${owner} rebuilds this as you use it.`, removable: true, owner });
      }
    }
  }

  for (const c of DEV_CACHES) {
    const p = path.join(HOME, c.rel);
    if (await exists(p)) candidates.push({ id: idOf("caches", p), category: "caches", path: p, label: c.label, detail: c.detail, removable: true });
  }

  // Login items that point at programs which no longer exist.
  const agents = path.join(LIB, "LaunchAgents");
  for (const name of await fs.readdir(agents).catch(() => [] as string[])) {
    if (!name.endsWith(".plist")) continue;
    const p = path.join(agents, name);
    const plist = await readPlist(p);
    const program = (plist?.Program as string | undefined) ?? (plist?.ProgramArguments as string[] | undefined)?.[0];
    if (program && path.isAbsolute(program) && !(await exists(program))) {
      candidates.push({ id: idOf("broken-login-items", p), category: "broken-login-items", path: p, label: String(plist?.Label ?? name), detail: `Tries to start ${program}, which isn't there anymore.`, removable: true });
    }
  }

  const sized = await pool(candidates, 6, async (c) => ({ ...c, bytes: await du(c.path) }));
  for (const c of sized) {
    if (c.owner && hiddenNames.has(c.owner)) continue;
    if (c.category === "caches" && c.bytes < 20e6) continue;
    if (c.category === "leftovers" && c.bytes < 4096 && !c.path.includes("/Preferences/")) continue;
    items.push(c);
  }

  // Apps you haven't opened in a long time, and apps that only run through Rosetta.
  const running = await runningApps();
  const cutoff = Date.now() - settings.staleDays * 86_400_000;
  await pool(apps.filter((a) => a.location !== "system" && !hidden.has(a.path)), 4, async (a) => {
    const q = quick[apps.indexOf(a)];
    const used = await lastUsed(a.path, q?.bundleId, q?.name);
    if (!running.has(a.path) && used !== undefined && used < cutoff) {
      items.push({
        id: idOf("stale-apps", a.path), category: "stale-apps", path: a.path, label: a.name,
        detail: `Last activity Teardown can find: ${new Date(used).toLocaleDateString("en-US", { month: "long", year: "numeric" })}.`,
        bytes: q?.sizeBytes ?? 0, removable: true, lastUsed: used,
      });
    }
    if (q && q.archs.length && !q.archs.includes("arm64") && process.arch === "arm64") {
      items.push({
        id: idOf("intel-only", a.path), category: "intel-only", path: a.path, label: a.name,
        detail: "Runs through Rosetta translation. Check the developer's site for an Apple silicon version.",
        bytes: q.sizeBytes, removable: false,
      });
    }
  });

  items.sort((a, b) => b.bytes - a.bytes);
  offered = new Map(items.map((i) => [i.id, i]));
  return { items, scannedAt: Date.now(), ms: Date.now() - t0 };
}

// Last guard before anything moves: only paths this scan offered, inside places it scans.
function safePath(p: string) {
  const resolved = path.resolve(p);
  if (resolved === HOME || resolved === LIB || resolved.split(path.sep).length < 4) return false;
  if (resolved.startsWith("/System/") || resolved.startsWith("/Library/")) return false;
  const roots = [LIB + path.sep, path.join(HOME, ".npm") + path.sep];
  if (roots.some((r) => resolved.startsWith(r))) return true;
  return resolved.endsWith(".app") && (resolved.startsWith("/Applications/") || resolved.startsWith(path.join(HOME, "Applications") + path.sep));
}

const appleString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

async function moveToTrash(p: string) {
  await fs.mkdir(TRASH, { recursive: true });
  let dest = path.join(TRASH, path.basename(p));
  if (await exists(dest)) {
    const ext = path.extname(p);
    dest = path.join(TRASH, `${path.basename(p, ext)} ${new Date().toISOString().replace(/[:.]/g, "-")}${ext}`);
  }
  try {
    await fs.rename(p, dest);
  } catch (e) {
    // Root-owned apps and protected folders need Finder, which can ask for your password.
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES" && code !== "EXDEV") throw e;
    const r = await run("osascript", ["-e", `tell application "Finder" to delete (POSIX file ${appleString(p)} as alias)`], 60_000);
    if (!r.ok) throw new Error(r.stderr.trim() || "Finder couldn't move it");
  }
}

export async function trash(ids: string[]): Promise<TrashResult[]> {
  const running = await runningApps();
  const results: TrashResult[] = [];
  for (const id of ids) {
    const item = offered.get(id);
    if (!item) {
      results.push({ id, path: "", ok: false, error: "Scan again before cleaning up.", bytes: 0 });
      continue;
    }
    const base = { id, path: item.path, bytes: item.bytes };
    if (!item.removable || !safePath(item.path)) results.push({ ...base, ok: false, error: "Teardown won't move this." });
    else if (running.has(item.path)) results.push({ ...base, ok: false, error: "Quit the app first." });
    else if (!(await exists(item.path))) results.push({ ...base, ok: false, error: "Already gone." });
    else {
      try {
        await moveToTrash(item.path);
        offered.delete(id);
        results.push({ ...base, ok: true });
      } catch (e) {
        results.push({ ...base, ok: false, error: (e as Error).message });
      }
    }
  }
  const log = await readJson<{ at: number; results: TrashResult[] }[]>(CLEANUP_LOG, []);
  log.unshift({ at: Date.now(), results });
  await writeJson(CLEANUP_LOG, log.slice(0, 200));
  return results;
}

export const cleanupLog = () => readJson<{ at: number; results: TrashResult[] }[]>(CLEANUP_LOG, []);
