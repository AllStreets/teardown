import { LayoutGrid, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppEntry, QuickReport, Report } from "../../shared/types";
import { api } from "./api";
import { STACK_COLOR } from "./format";
import { Overview } from "./components/Overview";
import { Teardown } from "./components/Teardown";

const SECTIONS: [AppEntry["location"], string][] = [
  ["applications", "Applications"],
  ["user", "Your Applications folder"],
  ["system", "Comes with macOS"],
];

function routePath() {
  const m = location.hash.match(/^#\/app\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function App() {
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [quick, setQuick] = useState<Record<string, QuickReport>>({});
  const [selected, setSelected] = useState<string | null>(routePath());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const onHash = () => setSelected(routePath());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Load the app list, then read every installed app in the background.
  useEffect(() => {
    let cancelled = false;
    api.apps().then(async (list) => {
      if (cancelled) return;
      setApps(list);
      const queue = [...list.filter((a) => a.location !== "system"), ...list.filter((a) => a.location === "system")];
      const worker = async () => {
        while (queue.length && !cancelled) {
          const a = queue.shift()!;
          try {
            const q = await api.quick(a.path);
            if (!cancelled) setQuick((prev) => ({ ...prev, [a.path]: q }));
          } catch {}
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .teardown(selected)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const open = useCallback((p: string | null) => {
    location.hash = p ? `#/app/${encodeURIComponent(p)}` : "#/";
  }, []);

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

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? apps.filter((a) => a.name.toLowerCase().includes(f) || quick[a.path]?.stackLabel.toLowerCase().includes(f)) : apps;
  }, [apps, filter, quick]);

  const selectedName = apps.find((a) => a.path === selected)?.name;

  return (
    <div className="shell">
      <aside className="rail">
        <div className="wordmark">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
            <circle cx="16" cy="16" r="11" fill="none" stroke="#7FD3FF" strokeWidth="3" strokeDasharray="40 12" />
            <circle cx="16" cy="16" r="4" fill="#E6F1FF" />
          </svg>
          Teardown
        </div>
        <label className="search">
          <Search size={15} aria-hidden />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an app or stack" aria-label="Find an app" />
        </label>
        <button className={`rail-item overview-item${!selected ? " active" : ""}`} onClick={() => open(null)}>
          <LayoutGrid size={16} aria-hidden /> Your Mac
        </button>
        <nav className="rail-list" aria-label="Installed apps">
          {SECTIONS.map(([loc, label]) => {
            const list = visible.filter((a) => a.location === loc);
            if (!list.length) return null;
            return (
              <section key={loc}>
                <h2 className="rail-heading">{label}</h2>
                {list.map((a) => {
                  const q = quick[a.path];
                  return (
                    <button key={a.path} className={`rail-item${selected === a.path ? " active" : ""}`} onClick={() => open(a.path)}>
                      <img src={api.icon(a.path)} alt="" width={22} height={22} loading="lazy" />
                      <span className="rail-name">{a.name}</span>
                      {q && <span className="dot" style={{ background: STACK_COLOR[q.stack] }} title={q.stackLabel} />}
                    </button>
                  );
                })}
              </section>
            );
          })}
        </nav>
      </aside>

      <main className="stage">
        {!selected && <Overview apps={apps} quick={quick} onOpen={open} />}
        {selected && loading && !report && <Scanning name={selectedName ?? "app"} />}
        {selected && error && (
          <div className="empty">
            <p>{error}</p>
            <button className="ghost" onClick={() => open(null)}>Back to your Mac</button>
          </div>
        )}
        {selected && report && report.path === selected && !error && (
          <Teardown report={report} onRescan={rescan} rescanning={rescanning} />
        )}
        {selected && loading && report && report.path !== selected && <Scanning name={selectedName ?? "app"} />}
      </main>
    </div>
  );
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
