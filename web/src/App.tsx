import { Activity, History, LayoutGrid, Search, Settings as SettingsIcon, Sparkles, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppEntry, CleanupScan, QuickReport, Report, Settings } from "../../shared/types";
import { api } from "./api";
import { STACK_COLOR, bytes } from "./format";
import { Changes } from "./components/Changes";
import { Cleanup } from "./components/Cleanup";
import { Live } from "./components/Live";
import { Overview } from "./components/Overview";
import { SettingsPage } from "./components/Settings";
import { Teardown } from "./components/Teardown";

type Route =
  | { page: "overview" }
  | { page: "changes" }
  | { page: "live" }
  | { page: "cleanup" }
  | { page: "settings" }
  | { page: "app"; path: string };

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("app/")) return { page: "app", path: decodeURIComponent(h.slice(4)) };
  if (h === "changes" || h === "live" || h === "cleanup" || h === "settings") return { page: h };
  return { page: "overview" };
}

export const go = (to: string) => {
  location.hash = to;
};
export const openApp = (path: string) => go(`#/app/${encodeURIComponent(path)}`);

const SECTIONS: [AppEntry["location"], string][] = [
  ["applications", "Applications"],
  ["user", "Your Applications folder"],
  ["system", "Comes with macOS"],
];

export function App() {
  const [route, setRoute] = useState<Route>(parse());
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [quick, setQuick] = useState<Record<string, QuickReport>>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [filter, setFilter] = useState("");
  const [badges, setBadges] = useState<{ changes?: number; live?: number; reclaim?: number }>({});
  const [cleanupScan, setCleanupScan] = useState<CleanupScan | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    api.settings().then(setSettings).catch(() => {});
  }, []);

  // Read every installed app in the background so the overview fills in live.
  const settingsReady = settings !== null;
  useEffect(() => {
    if (!settingsReady) return;
    let cancelled = false;
    api.apps(true).then(async (list) => {
      if (cancelled) return;
      setApps(list);
      const hidden = new Set(settings?.hiddenApps ?? []);
      const visibleList = list.filter((a) => !hidden.has(a.path));
      const queue = [...visibleList.filter((a) => a.location !== "system"), ...visibleList.filter((a) => a.location === "system")];
      const worker = async () => {
        while (queue.length && !cancelled) {
          const a = queue.shift()!;
          try {
            const r = await api.quick(a.path);
            if (!cancelled) setQuick((prev) => ({ ...prev, [a.path]: r }));
          } catch {}
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady]);

  // Counts shown next to each page in the sidebar.
  useEffect(() => {
    const refresh = () => {
      api.changes().then((c) => setBadges((b) => ({ ...b, changes: c.events.length }))).catch(() => {});
      api.live().then((l) => setBadges((b) => ({ ...b, live: l.apps.filter((a) => a.connections.length).length }))).catch(() => {});
    };
    refresh();
    const t = setInterval(refresh, 30_000);
    api.cleanup().then((s) => {
      setCleanupScan(s);
      setBadges((b) => ({ ...b, reclaim: s.items.filter((i) => i.removable).reduce((a, i) => a + i.bytes, 0) }));
    }).catch(() => {});
    return () => clearInterval(t);
  }, []);

  const selected = route.page === "app" ? route.path : null;

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.teardown(selected)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const rescan = useCallback(async () => {
    if (!selected) return;
    setRescanning(true);
    try {
      setReport(await api.teardown(selected, true));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRescanning(false);
    }
  }, [selected]);

  const shownApps = useMemo(() => {
    const hidden = new Set(settings?.hiddenApps ?? []);
    return apps.filter((a) => !hidden.has(a.path) && (settings?.includeSystem !== false || a.location !== "system"));
  }, [apps, settings]);
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? shownApps.filter((a) => a.name.toLowerCase().includes(f) || quick[a.path]?.stackLabel.toLowerCase().includes(f)) : shownApps;
  }, [shownApps, filter, quick]);

  const readCount = shownApps.filter((a) => quick[a.path]).length;
  const selectedName = apps.find((a) => a.path === selected)?.name;

  const nav: { to: string; page: Route["page"]; label: string; icon: LucideIcon; meta?: string }[] = [
    { to: "#/", page: "overview", label: "Your Mac", icon: LayoutGrid, meta: shownApps.length ? `${readCount === shownApps.length ? shownApps.length : `${readCount}/${shownApps.length}`} apps` : undefined },
    { to: "#/changes", page: "changes", label: "Changes", icon: History, meta: badges.changes ? String(badges.changes) : undefined },
    { to: "#/live", page: "live", label: "Live", icon: Activity, meta: badges.live !== undefined ? `${badges.live} online` : undefined },
    { to: "#/cleanup", page: "cleanup", label: "Clean up", icon: Sparkles, meta: badges.reclaim ? bytes(badges.reclaim) : undefined },
  ];

  return (
    <div className="shell">
      <aside className="rail">
        <a className="wordmark" href="#/" aria-label="Teardown home">
          <img src="/logo.svg" width={26} height={26} alt="" />
          Teardown
        </a>

        <nav className="primary-nav" aria-label="Pages">
          {nav.map((n) => (
            <a key={n.page} href={n.to} className={`nav-item${route.page === n.page ? " active" : ""}`} aria-current={route.page === n.page ? "page" : undefined}>
              <n.icon size={17} aria-hidden />
              <span className="nav-label">{n.label}</span>
              {n.meta && <span className="nav-meta">{n.meta}</span>}
            </a>
          ))}
        </nav>

        <label className="search">
          <Search size={15} aria-hidden />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an app or stack" aria-label="Find an app" />
        </label>

        <nav className="rail-list" aria-label="Installed apps">
          {SECTIONS.map(([loc, label]) => {
            const list = visible.filter((a) => a.location === loc);
            if (!list.length) return null;
            return (
              <section key={loc}>
                <h2 className="rail-heading">{label}</h2>
                {list.map((a) => {
                  const r = quick[a.path];
                  return (
                    <a key={a.path} href={`#/app/${encodeURIComponent(a.path)}`} className={`rail-item${selected === a.path ? " active" : ""}`}>
                      <img src={api.icon(a.path)} alt="" width={22} height={22} loading="lazy" />
                      <span className="rail-name">{a.name}</span>
                      {r && (
                        <span className="rail-bar" title={`${r.stackLabel}, ${bytes(r.sizeBytes)}`}>
                          <span style={{ width: `${barWidth(r.sizeBytes)}%`, background: STACK_COLOR[r.stack] }} />
                        </span>
                      )}
                    </a>
                  );
                })}
              </section>
            );
          })}
        </nav>

        <a href="#/settings" className={`nav-item settings-item${route.page === "settings" ? " active" : ""}`} aria-current={route.page === "settings" ? "page" : undefined}>
          <SettingsIcon size={17} aria-hidden />
          <span className="nav-label">Settings</span>
        </a>
      </aside>

      <main className="stage">
        {route.page === "overview" && <Overview apps={shownApps} quick={quick} onOpen={openApp} reclaim={badges.reclaim} />}
        {route.page === "changes" && <Changes onOpen={openApp} />}
        {route.page === "live" && <Live onOpen={openApp} />}
        {route.page === "cleanup" && (
          <Cleanup
            scan={cleanupScan}
            onScan={(s) => {
              setCleanupScan(s);
              setBadges((b) => ({ ...b, reclaim: s.items.filter((i) => i.removable).reduce((a, i) => a + i.bytes, 0) }));
            }}
          />
        )}
        {route.page === "settings" && <SettingsPage settings={settings} onChange={setSettings} apps={apps} />}
        {route.page === "app" && (
          <>
            {loading && (!report || report.path !== selected) && <Scanning name={selectedName ?? "app"} />}
            {error && (
              <div className="empty">
                <p>{error}</p>
                <a className="btn btn-ghost" href="#/">Back to your Mac</a>
              </div>
            )}
            {report && report.path === selected && !error && <Teardown report={report} onRescan={rescan} rescanning={rescanning} />}
          </>
        )}
      </main>
    </div>
  );
}

// Log scale, so a 9 GB app and a 10 MB app both get a visible bar.
function barWidth(size: number) {
  const k = Math.max(0, Math.min(1, (Math.log10(Math.max(size, 1e6)) - 6) / 4));
  return Math.round(10 + k * 90);
}

function Scanning({ name }: { name: string }) {
  return (
    <div className="scanning" aria-live="polite">
      <div className="scan-ring" aria-hidden />
      <p>Reading {name}</p>
      <p className="muted">Walking every file, checking the signature, and pulling strings out of the code.</p>
    </div>
  );
}
