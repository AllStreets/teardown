import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppEntry, QuickReport, Report } from "../shared/types.js";
import { fullReport, layout, quickReport } from "./analyze.js";
import { REPORT_DIR } from "./paths.js";
import { readJson, writeJson } from "./store.js";

const LOCATIONS: [string, AppEntry["location"]][] = [
  ["/Applications", "applications"],
  [path.join(os.homedir(), "Applications"), "user"],
  ["/System/Applications", "system"],
  ["/System/Applications/Utilities", "system"],
];

export async function findApps(): Promise<AppEntry[]> {
  const apps: AppEntry[] = [];
  for (const [dir, location] of LOCATIONS) {
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      const p = path.join(dir, n);
      if (n.endsWith(".app")) apps.push({ name: n.replace(/\.app$/, ""), path: p, location });
      else if (location !== "system" && !n.startsWith(".")) {
        // Vendors like Adobe nest their apps one folder deep.
        try {
          for (const inner of await fs.readdir(p)) {
            if (inner.endsWith(".app")) apps.push({ name: inner.replace(/\.app$/, ""), path: path.join(p, inner), location });
          }
        } catch {}
      }
    }
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

// Only real app bundles may be analysed.
export async function validApp(p: unknown): Promise<string | undefined> {
  if (typeof p !== "string" || !p.endsWith(".app") || !path.isAbsolute(p)) return undefined;
  const resolved = path.resolve(p);
  for (const inner of ["Contents", "WrappedBundle"]) {
    const st = await fs.stat(path.join(resolved, inner)).catch(() => undefined);
    if (st?.isDirectory()) return resolved;
  }
  return undefined;
}

// Changes whenever an app is updated or replaced.
export async function stamp(app: string) {
  try {
    return Math.round((await fs.stat((await layout(app)).info)).mtimeMs);
  } catch {
    return 0;
  }
}

export const cacheKey = (app: string) => app.replace(/[^A-Za-z0-9]+/g, "_");

async function cached<T>(kind: string, app: string, make: () => Promise<T>, fresh = false): Promise<T> {
  const file = path.join(REPORT_DIR, `${kind}-${cacheKey(app)}.json`);
  const s = await stamp(app);
  if (!fresh) {
    const hit = await readJson<{ stamp: number; data: T } | null>(file, null);
    if (hit && hit.stamp === s) return hit.data;
  }
  const data = await make();
  await writeJson(file, { stamp: s, data });
  return data;
}

const inflight = new Map<string, Promise<unknown>>();
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const getQuick = (app: string) => once(`q:${app}`, () => cached<QuickReport>("quick", app, () => quickReport(app)));
export const getFull = (app: string, fresh = false) => once(`f:${app}:${fresh}`, () => cached<Report>("full", app, () => fullReport(app), fresh));

export async function cachedFull(app: string): Promise<Report | undefined> {
  const hit = await readJson<{ data: Report } | null>(path.join(REPORT_DIR, `full-${cacheKey(app)}.json`), null);
  return hit?.data;
}
