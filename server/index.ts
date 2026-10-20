import express from "express";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppEntry, QuickReport, Report } from "../shared/types.js";
import { fullReport, quickReport } from "./analyze.js";
import { readPlist, run } from "./run.js";

const PORT = 4710;
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, ".cache");
const iconDir = path.join(cacheDir, "icons");
await fs.mkdir(iconDir, { recursive: true });

const LOCATIONS: [string, AppEntry["location"]][] = [
  ["/Applications", "applications"],
  [path.join(os.homedir(), "Applications"), "user"],
  ["/System/Applications", "system"],
  ["/System/Applications/Utilities", "system"],
];

async function findApps(): Promise<AppEntry[]> {
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
async function validApp(p: unknown): Promise<string | undefined> {
  if (typeof p !== "string" || !p.endsWith(".app") || !path.isAbsolute(p)) return undefined;
  const resolved = path.resolve(p);
  try {
    const st = await fs.stat(path.join(resolved, "Contents"));
    return st.isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

async function stamp(app: string) {
  try {
    return (await fs.stat(path.join(app, "Contents", "Info.plist"))).mtimeMs;
  } catch {
    return 0;
  }
}

const cacheKey = (app: string) => app.replace(/[^A-Za-z0-9]+/g, "_");

async function cached<T>(kind: string, app: string, make: () => Promise<T>): Promise<T> {
  const file = path.join(cacheDir, `${kind}-${cacheKey(app)}.json`);
  const s = await stamp(app);
  try {
    const hit = JSON.parse(await fs.readFile(file, "utf8")) as { stamp: number; data: T };
    if (hit.stamp === s) return hit.data;
  } catch {}
  const data = await make();
  await fs.writeFile(file, JSON.stringify({ stamp: s, data }));
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

const app = express();

app.get("/api/apps", async (_req, res) => {
  res.json(await findApps());
});

app.get("/api/quick", async (req, res) => {
  const p = await validApp(req.query.path);
  if (!p) return res.status(400).json({ error: "Not an app bundle" });
  res.json(await once(`q:${p}`, () => cached<QuickReport>("quick", p, () => quickReport(p))));
});

app.get("/api/teardown", async (req, res) => {
  const p = await validApp(req.query.path);
  if (!p) return res.status(400).json({ error: "Not an app bundle" });
  try {
    const fresh = req.query.fresh === "1";
    const make = () => fullReport(p);
    const report = await once(`f:${p}:${fresh}`, () => (fresh ? make() : cached<Report>("full", p, make)));
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: `Couldn't read this app: ${(e as Error).message}` });
  }
});

app.get("/api/icon", async (req, res) => {
  const p = await validApp(req.query.path);
  if (!p) return res.status(400).end();
  const out = path.join(iconDir, `${cacheKey(p)}-${Math.round(await stamp(p))}.png`);
  try {
    await fs.access(out);
  } catch {
    const info = (await readPlist(path.join(p, "Contents", "Info.plist"))) ?? {};
    let icon = typeof info.CFBundleIconFile === "string" ? info.CFBundleIconFile : undefined;
    if (!icon && typeof info.CFBundleIconName === "string") icon = info.CFBundleIconName;
    const res_ = path.join(p, "Contents", "Resources");
    let file = icon ? path.join(res_, icon.endsWith(".icns") ? icon : `${icon}.icns`) : undefined;
    if (!file || !(await fs.access(file).then(() => true, () => false))) {
      const any = (await fs.readdir(res_).catch(() => [])).find((f) => f.endsWith(".icns"));
      file = any ? path.join(res_, any) : undefined;
    }
    if (!file) return res.status(404).end();
    const r = await run("sips", ["-s", "format", "png", "-Z", "256", file, "--out", out], 10_000);
    if (!r.ok) return res.status(404).end();
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(out, { dotfiles: "allow" });
});

app.post("/api/reveal", async (req, res) => {
  const p = await validApp(req.query.path);
  if (!p) return res.status(400).end();
  await run("open", ["-R", p], 5_000);
  res.status(204).end();
});

const dist = path.join(root, "dist");
app.use(express.static(dist));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Teardown analysis server on http://127.0.0.1:${PORT}`);
});
