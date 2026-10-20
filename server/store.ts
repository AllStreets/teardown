import { promises as fs } from "node:fs";
import path from "node:path";
import type { Settings } from "../shared/types.js";
import { SETTINGS_FILE } from "./paths.js";

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// Write to a temp file first so a crash never leaves half a file behind.
export async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file);
}

export const DEFAULT_SETTINGS: Settings = {
  watch: true,
  intervalMinutes: 30,
  includeSystem: true,
  staleDays: 180,
  hiddenApps: [],
  keepVersions: true,
  notifyUpdates: "notable",
  notifyArrivals: true,
};

let current: Settings | undefined;

export async function getSettings(): Promise<Settings> {
  current ??= { ...DEFAULT_SETTINGS, ...(await readJson<Partial<Settings>>(SETTINGS_FILE, {})) };
  return current;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const s = await getSettings();
  const next: Settings = {
    watch: typeof patch.watch === "boolean" ? patch.watch : s.watch,
    intervalMinutes: [15, 30, 60, 360, 1440].includes(Number(patch.intervalMinutes)) ? Number(patch.intervalMinutes) : s.intervalMinutes,
    includeSystem: typeof patch.includeSystem === "boolean" ? patch.includeSystem : s.includeSystem,
    staleDays: [90, 180, 365, 730].includes(Number(patch.staleDays)) ? Number(patch.staleDays) : s.staleDays,
    hiddenApps: Array.isArray(patch.hiddenApps)
      ? [...new Set(patch.hiddenApps.filter((p): p is string => typeof p === "string" && p.endsWith(".app")))].sort()
      : s.hiddenApps,
    keepVersions: typeof patch.keepVersions === "boolean" ? patch.keepVersions : s.keepVersions,
    notifyUpdates: patch.notifyUpdates && ["notable", "all", "off"].includes(patch.notifyUpdates) ? patch.notifyUpdates : s.notifyUpdates,
    notifyArrivals: typeof patch.notifyArrivals === "boolean" ? patch.notifyArrivals : s.notifyArrivals,
  };
  current = next;
  await writeJson(SETTINGS_FILE, next);
  return next;
}

export async function dirStats(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  async function walk(d: string) {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        files++;
        bytes += (await fs.stat(p).catch(() => ({ size: 0 }))).size;
      }
    }
  }
  await walk(dir);
  return { files, bytes };
}
