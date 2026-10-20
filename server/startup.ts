import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StartupItem } from "../shared/types.js";
import { findApps, getQuick } from "./apps.js";
import { APP_BUNDLE } from "./paths.js";
import { pool, readPlist, run } from "./run.js";

const HOME = os.homedir();
const UID = process.getuid?.() ?? 501;
const PLACES: [string, StartupItem["scope"]][] = [
  [path.join(HOME, "Library", "LaunchAgents"), "user"],
  ["/Library/LaunchAgents", "system-agent"],
  ["/Library/LaunchDaemons", "system-daemon"],
];
const SELF_LABEL = "com.allstreets.teardown.launcher";
const domain = (scope: StartupItem["scope"]) => (scope === "system-daemon" ? "system" : `gui/${UID}`);

async function disabledSet(dom: string) {
  const r = await run("launchctl", ["print-disabled", dom], 5_000);
  const s = new Set<string>();
  for (const m of r.stdout.matchAll(/"([^"]+)"\s*=>\s*(true|disabled)/g)) s.add(m[1]);
  return s;
}

let lastList: StartupItem[] = [];

export async function listStartup(): Promise<StartupItem[]> {
  const apps = await findApps();
  const quick = await pool(apps, 4, (a) => getQuick(a.path).catch(() => undefined));
  const vendors = new Map<string, { name: string; path: string }[]>();
  quick.forEach((q, i) => {
    if (!q?.bundleId) return;
    const v = q.bundleId.toLowerCase().split(".").slice(0, 2).join(".");
    vendors.set(v, [...(vendors.get(v) ?? []), { name: q.name, path: apps[i].path }]);
  });
  // Credit an app only when the item's name points at it, or the vendor has just one app here.
  const byVendor = (label: string) => {
    const parts = label.toLowerCase().split(".");
    const list = vendors.get(parts.slice(0, 2).join(".")) ?? [];
    const named = list.find((a) => parts.slice(2).some((p) => p.length > 2 && a.name.toLowerCase().replace(/\s+/g, "").includes(p.replace(/[^a-z0-9]/g, ""))));
    return named ?? (list.length === 1 ? list[0] : undefined);
  };
  const [userOff, sysOff] = await Promise.all([disabledSet(`gui/${UID}`), disabledSet("system")]);

  const items: StartupItem[] = [];
  for (const [dir, scope] of PLACES) {
    for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
      if (!f.endsWith(".plist")) continue;
      const plist = path.join(dir, f);
      const p = await readPlist(plist);
      const label = String(p?.Label ?? f.replace(/\.plist$/, ""));
      if (label === SELF_LABEL) continue;
      const program = (p?.Program as string | undefined) ?? (p?.ProgramArguments as string[] | undefined)?.[0];
      const inApp = program?.indexOf(".app/") ?? -1;
      const appPath = program && inApp >= 0 ? program.slice(0, inApp + 4) : undefined;
      const app = (appPath && apps.find((a) => a.path === appPath)) || byVendor(label);
      const loaded = (await run("launchctl", ["print", `${domain(scope)}/${label}`], 4_000)).ok;
      items.push({
        label,
        plist,
        program,
        scope,
        app: app ? { name: app.name, path: app.path } : undefined,
        loaded,
        disabled: (scope === "system-daemon" ? sysOff : userOff).has(label) || p?.Disabled === true,
        missing: !!program && path.isAbsolute(program) && !(await fs.access(program).then(() => true, () => false)),
        runAtLoad: p?.RunAtLoad === true,
        keepAlive: !!p?.KeepAlive,
      });
    }
  }
  items.sort((a, b) => Number(a.scope !== "user") - Number(b.scope !== "user") || a.label.localeCompare(b.label));
  lastList = items;
  return items;
}

const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

// Turning an item off unloads it and marks it disabled, so it stays off after a restart.
// Turning it back on reverses both steps exactly. Nothing is deleted.
export async function toggleStartup(plistPath: unknown, enable: boolean) {
  const item = lastList.find((i) => i.plist === plistPath);
  if (!item) throw new Error("List startup items again first.");
  if (!/^[A-Za-z0-9._-]+$/.test(item.label)) throw new Error("Teardown won't touch an item with an unusual name.");
  const dom = domain(item.scope);
  const cmds = enable
    ? [["enable", `${dom}/${item.label}`], ["bootstrap", dom, item.plist]]
    : [["bootout", dom, item.plist], ["disable", `${dom}/${item.label}`]];
  if (item.scope === "user") {
    for (const c of cmds) await run("launchctl", c, 10_000);
  } else {
    // Machine-wide items belong to root, so macOS asks for your password.
    const script = cmds.map((c) => `/bin/launchctl ${c.map(sh).join(" ")}`).join("; ");
    const r = await run("osascript", ["-e", `do shell script ${JSON.stringify(script + "; true")} with administrator privileges`], 120_000);
    if (!r.ok) throw new Error(/cancel/i.test(r.stderr) ? "Cancelled." : r.stderr.trim() || "macOS refused.");
  }
  return (await listStartup()).find((i) => i.plist === item.plist);
}

// Teardown itself: a user launch agent that opens the app hidden at login.
export async function setLaunchAtLogin(on: boolean) {
  const plist = path.join(HOME, "Library", "LaunchAgents", `${SELF_LABEL}.plist`);
  if (!on) {
    await run("launchctl", ["bootout", `gui/${UID}`, plist], 5_000);
    await fs.rm(plist, { force: true });
    return { ok: true };
  }
  if (!APP_BUNDLE) return { ok: false, note: "Launch at login works from the Mac app, not the browser version." };
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${SELF_LABEL}</string>
  <key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>-a</string><string>${APP_BUNDLE}</string><string>--args</string><string>--hidden</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
`;
  await fs.mkdir(path.dirname(plist), { recursive: true });
  await fs.writeFile(plist, xml);
  return { ok: true };
}

export const launchAtLoginEnabled = () => fs.access(path.join(HOME, "Library", "LaunchAgents", `${SELF_LABEL}.plist`)).then(() => true, () => false);
