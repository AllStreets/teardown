import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { StorageInfo } from "../shared/types.js";
import { cacheKey, findApps, getFull, getQuick, stamp, validApp } from "./apps.js";
import { layout } from "./analyze.js";
import { cleanupLog, scanCleanup, trash } from "./cleanup.js";
import { checkNow, observe, readChanges, snapshotsFor, startWatching, watchStatus } from "./history.js";
import { liveConnections, selfConnections } from "./network.js";
import { arrivals, openArrival, trashArrival, watchArrivals } from "./arrivals.js";
import { noticesSince } from "./notices.js";
import { diagnostics, readGrants, revoke } from "./permissions.js";
import { listStartup, setLaunchAtLogin, toggleStartup } from "./startup.js";
import { listVersions, rollback, versionStorage } from "./versions.js";
import { CHANGES_FILE, CLEANUP_LOG, DATA_DIR, DIST_DIR, ICON_DIR, PORT, REPORT_DIR, SNAPSHOT_DIR, VERSION } from "./paths.js";
import { readPlist, run } from "./run.js";
import { dirStats, getSettings, readJson, updateSettings } from "./store.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// The UI and engine talk over localhost only; refuse anything that isn't from this machine.
app.use("/api", (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !/^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?|tauri:\/\/localhost)$/.test(origin)) {
    return res.status(403).json({ error: "Teardown only answers requests from this Mac." });
  }
  next();
});

const wrap = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => (req: express.Request, res: express.Response) => {
  fn(req, res).catch((e: Error) => res.status(500).json({ error: e.message }));
};

app.get("/api/apps", wrap(async (req, res) => {
  res.json(await findApps({ includeHidden: req.query.all === "1" }));
}));

app.get("/api/quick", wrap(async (req, res) => {
  const p = await validApp(req.query.path);
  if (!p) return res.status(400).json({ error: "That isn't an app bundle." });
  res.json(await getQuick(p));
}));

app.get("/api/teardown", wrap(async (req, res) => {
  const p = await validApp(req.query.path);
  if (!p) return res.status(400).json({ error: "That isn't an app bundle." });
  const report = await getFull(p, req.query.fresh === "1");
  observe(report).catch(() => {});
  res.json(report);
}));

app.get("/api/history", wrap(async (req, res) => {
  const p = await validApp(req.query.path);
  if (!p) return res.status(400).json({ error: "That isn't an app bundle." });
  const [snaps, changes] = await Promise.all([snapshotsFor(p), readChanges()]);
  res.json({ snapshots: snaps.map((s) => ({ version: s.version, takenAt: s.takenAt })), changes: changes.filter((c) => c.path === p) });
}));

app.get("/api/changes", wrap(async (_req, res) => {
  const hidden = new Set((await getSettings()).hiddenApps);
  res.json({ events: (await readChanges()).filter((e) => !hidden.has(e.path)), status: watchStatus() });
}));

app.post("/api/changes/check", wrap(async (_req, res) => {
  checkNow().catch(() => {});
  res.json(watchStatus());
}));

app.get("/api/live", wrap(async (_req, res) => {
  res.json(await liveConnections());
}));

let lastScan: { at: number; data: Awaited<ReturnType<typeof scanCleanup>> } | undefined;
app.get("/api/cleanup", wrap(async (req, res) => {
  if (!lastScan || req.query.fresh === "1" || Date.now() - lastScan.at > 10 * 60_000) {
    lastScan = { at: Date.now(), data: await scanCleanup() };
  }
  res.json(lastScan.data);
}));

app.post("/api/cleanup/trash", wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === "string") : [];
  const results = await trash(ids);
  if (lastScan) {
    const moved = new Set(results.filter((r) => r.ok).map((r) => r.id));
    lastScan.data = { ...lastScan.data, items: lastScan.data.items.filter((i) => !moved.has(i.id)) };
  }
  res.json(results);
}));

app.get("/api/cleanup/log", wrap(async (_req, res) => {
  res.json(await cleanupLog());
}));

app.get("/api/settings", wrap(async (_req, res) => {
  res.json(await getSettings());
}));

app.put("/api/settings", wrap(async (req, res) => {
  const before = await getSettings();
  const next = await updateSettings(req.body ?? {});
  if (next.launchAtLogin !== before.launchAtLogin) {
    const r = await setLaunchAtLogin(next.launchAtLogin);
    if (!r.ok) {
      await updateSettings({ launchAtLogin: false });
      return res.status(400).json({ error: r.note });
    }
  }
  await startWatching();
  res.json(next);
}));

app.get("/api/storage", wrap(async (_req, res) => {
  const [reports, snapshots, icons, log] = await Promise.all([
    dirStats(REPORT_DIR), dirStats(SNAPSHOT_DIR), dirStats(ICON_DIR), readJson<unknown[]>(CLEANUP_LOG, []),
  ]);
  const info: StorageInfo = { dataDir: DATA_DIR, reports, snapshots, icons, cleanupLog: log.length, versions: await versionStorage() };
  res.json(info);
}));

app.post("/api/storage/clear", wrap(async (req, res) => {
  const what = String(req.query.what);
  const targets: Record<string, string[]> = {
    cache: [REPORT_DIR, ICON_DIR],
    history: [SNAPSHOT_DIR, CHANGES_FILE, CLEANUP_LOG],
  };
  if (!targets[what]) return res.status(400).json({ error: "Unknown data type." });
  for (const t of targets[what]) await fs.rm(t, { recursive: true, force: true });
  res.status(204).end();
}));

app.get("/api/self", wrap(async (_req, res) => {
  res.json({ ...(await selfConnections()), version: VERSION });
}));

app.post("/api/reveal", wrap(async (req, res) => {
  const target = req.query.target === "data" ? DATA_DIR : req.query.target === "trash" ? path.join(process.env.HOME ?? "", ".Trash") : await validApp(req.query.path);
  if (!target) return res.status(400).end();
  await fs.mkdir(DATA_DIR, { recursive: true });
  await run("open", req.query.target ? [target] : ["-R", target], 5_000);
  res.status(204).end();
}));

app.get("/api/icon", wrap(async (req, res) => {
  const p = await validApp(req.query.path);
  if (!p) return res.status(400).end();
  await fs.mkdir(ICON_DIR, { recursive: true });
  const out = path.join(ICON_DIR, `${cacheKey(p)}-${await stamp(p)}.png`);
  if (!(await fs.access(out).then(() => true, () => false))) {
    const lay = await layout(p);
    const info = (await readPlist(lay.info)) ?? {};
    const icon = typeof info.CFBundleIconFile === "string" ? info.CFBundleIconFile : typeof info.CFBundleIconName === "string" ? info.CFBundleIconName : undefined;
    const resDir = lay.ios ? lay.contents : path.join(lay.contents, "Resources");
    const names = await fs.readdir(resDir).catch(() => [] as string[]);
    let file = icon ? path.join(resDir, icon.endsWith(".icns") ? icon : `${icon}.icns`) : undefined;
    if (!file || !(await fs.access(file).then(() => true, () => false))) {
      // iPhone apps ship PNG app icons instead of an .icns file; take the largest.
      const pick = names.find((f) => f.endsWith(".icns")) ?? names.filter((f) => /^AppIcon.*\.png$/.test(f)).sort((a, b) => b.length - a.length || b.localeCompare(a))[0];
      file = pick ? path.join(resDir, pick) : undefined;
    }
    if (!file) return res.status(404).end();
    const r = await run("sips", ["-s", "format", "png", "-Z", "256", file, "--out", out], 10_000);
    if (!r.ok) return res.status(404).end();
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(out, { dotfiles: "allow" });
}));

app.get("/api/notifications", wrap(async (req, res) => {
  res.json(await noticesSince(Number(req.query.since ?? 0)));
}));

app.get("/api/change", wrap(async (req, res) => {
  const ev = (await readChanges()).find((e) => e.id === req.query.id);
  if (!ev) return res.status(404).json({ error: "That change isn't recorded." });
  const snaps = await snapshotsFor(ev.path);
  const i = snaps.findIndex((x) => x.takenAt === ev.detectedAt);
  res.json({ event: ev, before: i > 0 ? snaps[i - 1] : undefined, after: snaps[i], versions: await listVersions(ev.path) });
}));

app.get("/api/versions", wrap(async (req, res) => {
  const p = await validApp(req.query.path);
  if (!p) return res.status(400).json({ error: "That isn't an app bundle." });
  res.json(await listVersions(p));
}));

app.post("/api/rollback", wrap(async (req, res) => {
  const p = await validApp(req.body?.path);
  if (!p) return res.status(400).json({ error: "That isn't an app bundle." });
  res.json(await rollback(p, Number(req.body?.savedAt)));
}));

app.get("/api/arrivals", wrap(async (_req, res) => {
  res.json(arrivals());
}));
app.post("/api/arrivals/open", wrap(async (req, res) => {
  await openArrival(req.body?.path);
  res.status(204).end();
}));
app.post("/api/arrivals/trash", wrap(async (req, res) => {
  await trashArrival(req.body?.path);
  res.status(204).end();
}));

// Opens the Full Disk Access pane, so you can let Teardown read the permissions you've granted.
app.post("/api/open-settings", wrap(async (_req, res) => {
  await run("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"], 5_000);
  res.status(204).end();
}));

app.get("/api/diagnostics", wrap(async (_req, res) => {
  await readGrants().catch(() => {});
  res.json({ pid: process.pid, ppid: process.ppid, app: process.env.TEARDOWN_APP ?? null, permissions: diagnostics });
}));

app.get("/api/startup", wrap(async (_req, res) => {
  res.json(await listStartup());
}));
app.post("/api/startup/toggle", wrap(async (req, res) => {
  res.json(await toggleStartup(req.body?.plist, req.body?.enable === true));
}));

app.get("/api/permissions", wrap(async (_req, res) => {
  res.json(await readGrants());
}));
app.post("/api/permissions/revoke", wrap(async (req, res) => {
  res.json(await revoke(String(req.body?.service ?? ""), String(req.body?.client ?? "")));
}));

app.use(express.static(DIST_DIR));
app.get(/^\/(?!api\/).*/, (_req, res, next) => {
  res.sendFile(path.join(DIST_DIR, "index.html"), (err) => err && next());
});

// Started by the Mac app: if the app goes away without cleaning up, don't linger holding the port.
if (process.env.TEARDOWN_APP) {
  const parent = process.ppid;
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      process.exit(0);
    }
    if (process.ppid !== parent) process.exit(0);
  }, 3_000).unref();
}

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Teardown engine on http://127.0.0.1:${PORT} (data in ${DATA_DIR})`);
  startWatching().catch(() => {});
  watchArrivals();
});
