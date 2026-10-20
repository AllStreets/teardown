import { CircleAlert, CircleCheck, CircleDot, FolderSearch, Info, RotateCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, LiveApp, Report, Severity } from "../../../shared/types";
import { ChangeList, when } from "./Changes";
import { api } from "../api";
import { STACK_COLOR, STACK_NAME, bytes } from "../format";
import { Specimen } from "./Specimen";
import { Button } from "./ui";

const TABS = ["Built with", "Permissions", "Network", "Inside", "History"] as const;
type Tab = (typeof TABS)[number];

const SEVERITY_ICON: Record<Severity, typeof Info> = {
  notable: CircleAlert,
  info: CircleDot,
  good: CircleCheck,
};

export function Teardown({ report, onRescan, rescanning }: { report: Report; onRescan: () => void; rescanning: boolean }) {
  const [tab, setTab] = useState<Tab>("Built with");
  const [lead, ...rest] = report.verdict;

  const counts: Record<Tab, number | undefined> = {
    "Built with": undefined,
    Permissions: report.permissions.length + report.entitlements.length,
    Network: report.domains.length,
    Inside: report.frameworks.length + report.helpers.length + (report.npm?.packages.length ?? 0),
    History: undefined,
  };

  return (
    <article className="teardown" key={report.path}>
      <header className="td-head">
        <img className="td-icon" src={api.icon(report.path)} alt="" width={72} height={72} />
        <div className="td-title">
          <h1>{report.name}</h1>
          <p className="td-meta">
            {report.bundleId && <code>{report.bundleId}</code>}
            {report.version && <span>Version {report.version}</span>}
            <span>{bytes(report.sizeBytes)}</span>
            <span className="stack-tag" style={{ color: STACK_COLOR[report.stack] }}>
              <span className="dot" style={{ background: STACK_COLOR[report.stack] }} />
              {report.stackLabel}
            </span>
          </p>
        </div>
        <div className="td-actions">
          <Button icon={FolderSearch} onClick={() => api.reveal(report.path)}>Show in Finder</Button>
          <Button icon={RotateCw} busy={rescanning} onClick={onRescan}>{rescanning ? "Rescanning" : "Rescan"}</Button>
        </div>
      </header>

      <section className="verdict" aria-label="Summary">
        <p className="verdict-lead">{lead}</p>
        {rest.length > 0 && <p className="verdict-rest">{rest.join(" ")}</p>}
      </section>

      <div className="td-grid">
        <Specimen tree={report.tree} total={report.sizeBytes} fileCount={report.fileCount} />
        <section className="findings" aria-label="Findings">
          <h2>What stands out</h2>
          <ul>
            {report.findings.map((f, i) => {
              const Icon = SEVERITY_ICON[f.severity];
              return (
                <li key={i} className={`finding ${f.severity}`}>
                  <Icon size={18} aria-hidden className="finding-icon" />
                  <div>
                    <p className="finding-title">{f.title}</p>
                    <p className="finding-detail">{f.detail}</p>
                    {f.evidence && <code className="evidence">{f.evidence}</code>}
                  </div>
                </li>
              );
            })}
            {report.findings.length === 0 && <li className="finding info">Nothing unusual turned up.</li>}
          </ul>
        </section>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className="tab" onClick={() => setTab(t)}>
            {t}
            {counts[t] !== undefined && <span className="tab-count">{counts[t]}</span>}
          </button>
        ))}
      </div>

      <div className="tab-body" role="tabpanel">
        {tab === "Built with" && <BuiltWith r={report} />}
        {tab === "Permissions" && <Permissions r={report} />}
        {tab === "Network" && <Network r={report} />}
        {tab === "Inside" && <Inside r={report} />}
        {tab === "History" && <HistoryTab r={report} />}
      </div>

      <p className="td-foot">Read in {(report.analyzedMs / 1000).toFixed(1)} seconds, entirely on this Mac. Nothing was run or uploaded.</p>
    </article>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function BuiltWith({ r }: { r: Report }) {
  const s = r.signing;
  return (
    <div className="cols">
      <div>
        <h3>How we know</h3>
        <ul className="evidence-list">
          {r.stackDetections.map((d, i) => (
            <li key={i}>
              <p>
                <strong>{d.label}</strong>
                {d.detail && <span className="muted"> {d.detail}</span>}
              </p>
              {d.evidence.map((e) => (
                <code key={e}>{e}</code>
              ))}
            </li>
          ))}
          {r.stackDetections.length === 0 && <li className="muted">No framework signatures matched.</li>}
        </ul>
        {r.languages.length > 0 && (
          <>
            <h3>Languages</h3>
            <p className="chips">
              {r.languages.map((l) => (
                <span key={l.label} className="chip" title={l.evidence.join("\n")}>{l.label}</span>
              ))}
            </p>
          </>
        )}
      </div>
      <dl className="facts">
        {r.electron?.version && <Row label="Electron">{r.electron.version}</Row>}
        {r.electron?.chromium && <Row label="Chromium">{r.electron.chromium}</Row>}
        {r.engineBytes > 0 && <Row label="Browser engine size">{bytes(r.engineBytes)}</Row>}
        <Row label="Processors">{r.archs.map((a) => (a === "arm64" ? "Apple silicon" : a === "x86_64" ? "Intel" : a)).join(", ") || "Unknown"}</Row>
        {r.minOS && <Row label="Needs macOS">{r.minOS} or later</Row>}
        <Row label="Signed by">{s.signed ? (s.adhoc ? "Ad hoc, no identity" : s.authority ?? "Unknown") : "Not signed"}</Row>
        {s.teamId && <Row label="Team ID"><code>{s.teamId}</code></Row>}
        {s.gatekeeper && <Row label="Gatekeeper">{s.gatekeeper}</Row>}
        {s.timestamp && <Row label="Signed on">{s.timestamp}</Row>}
        <Row label="Hardened runtime">{s.hardenedRuntime ? "On" : "Off"}</Row>
        <Row label="App Sandbox">{r.sandboxed ? "On" : "Off"}</Row>
        {r.copyright && <Row label="Copyright">{r.copyright}</Row>}
      </dl>
    </div>
  );
}

function Permissions({ r }: { r: Report }) {
  return (
    <div className="cols">
      <div>
        <h3>What it can ask you for</h3>
        {r.permissions.length === 0 && <p className="muted">It doesn't declare any privacy prompts.</p>}
        <ul className="prompts">
          {r.permissions.map((p) => (
            <li key={p.key}>
              <p className="prompt-label">{p.label}</p>
              <blockquote>{p.reason}</blockquote>
              <code>{p.key}</code>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3>What Apple lets it do</h3>
        {r.entitlements.length === 0 && <p className="muted">It has no entitlements.</p>}
        <ul className="ents">
          {r.entitlements.map((e) => (
            <li key={e.key} className={e.risky ? "risky" : undefined}>
              <p>{e.label ?? <code>{e.key}</code>}</p>
              {e.label && <code>{e.key}</code>}
              {e.value !== "true" && <span className="ent-value">{e.value}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function useLive(path: string) {
  const [live, setLive] = useState<LiveApp | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () => api.live().then((s) => alive && setLive(s.apps.find((a) => a.path === path) ?? null)).catch(() => {});
    load();
    const t = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [path]);
  return live;
}

function Network({ r }: { r: Report }) {
  const [q, setQ] = useState("");
  const live = useLive(r.path);
  const shown = useMemo(() => r.domains.filter((d) => d.host.includes(q.toLowerCase())), [r.domains, q]);
  const max = r.domains[0]?.count ?? 1;
  return (
    <div className="cols">
      <div>
        <h3>Right now</h3>
        {live === undefined && <p className="muted">Checking open connections.</p>}
        {live === null && <p className="muted">{r.name} has no open connections. Open it and this updates within a few seconds.</p>}
        {live && (
          <ul className="conn-list compact">
            {live.connections.map((c) => (
              <li key={`${c.remote}:${c.port}`}>
                <span className={`conn-dot${c.mentioned ? " known" : ""}`} aria-hidden />
                <code className="conn-host" title={c.remote}>{c.host ?? c.remote}</code>
                <span className="muted conn-port">port {c.port}</span>
                {c.mentioned && <span className="conn-tag">In its code</span>}
              </li>
            ))}
            {live.connections.length === 0 && <li className="muted">Only listening on {live.listening.join(", ")}.</li>}
          </ul>
        )}
        <h3>SDKs that phone home</h3>
        {r.sdks.length === 0 && <p className="muted">No known third-party SDKs found.</p>}
        <ul className="sdks">
          {r.sdks.map((s) => (
            <li key={s.name}>
              <p><strong>{s.name}</strong> <span className="muted">{s.category}</span></p>
              <code>{s.evidence}</code>
            </li>
          ))}
        </ul>
        <p className="note">
          These are the web addresses written into the app's code. Finding an address means the app knows about it, not that it connects every time.
        </p>
      </div>
      <div>
        <label className="search small">
          <Search size={15} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${r.domains.length} addresses`} />
        </label>
        <ul className="domains">
          {shown.map((d) => (
            <li key={d.host}>
              <span className="bar" style={{ width: `${Math.max(4, (d.count / max) * 100)}%` }} />
              <code>{d.host}</code>
              {d.sdk && <span className="sdk-tag">{d.sdk}</span>}
              <span className="count">{d.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Inside({ r }: { r: Report }) {
  const maxFw = r.frameworks[0]?.size ?? 1;
  return (
    <div className="cols">
      <div>
        <h3>Frameworks and libraries</h3>
        {r.frameworks.length === 0 && <p className="muted">Nothing bundled in Contents/Frameworks.</p>}
        <ul className="sizes">
          {r.frameworks.slice(0, 40).map((f) => (
            <li key={f.name}>
              <span className="bar" style={{ width: `${Math.max(2, (f.size / maxFw) * 100)}%` }} />
              <code>{f.name}</code>
              <span className="count">{bytes(f.size)}</span>
            </li>
          ))}
        </ul>
        {r.helpers.length > 0 && (
          <>
            <h3>Helpers and extensions</h3>
            <ul className="helpers">
              {r.helpers.map((h, i) => (
                <li key={i}><code>{h.name}</code><span className="muted">{h.kind}</span></li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div>
        {r.npm && (
          <>
            <h3>
              {r.npm.total.toLocaleString()} npm packages
              {r.npm.app?.version && <span className="muted"> in {r.npm.app.name ?? "the app"} {r.npm.app.version}</span>}
            </h3>
            <p className="chips">
              {r.npm.packages.map((p) => (
                <span key={p.name} className={`chip${p.native ? " native" : ""}`} title={p.native ? "Contains native code" : undefined}>
                  {p.name}
                  {p.version && <span className="muted">{p.version}</span>}
                </span>
              ))}
            </p>
          </>
        )}
        {r.localizations.length > 0 && (
          <>
            <h3>{r.localizations.length} languages</h3>
            <p className="muted wrap">{r.localizations.join(", ")}</p>
          </>
        )}
        {r.urlSchemes.length > 0 && (
          <>
            <h3>Links it opens</h3>
            <p className="chips">{r.urlSchemes.map((u) => <code key={u} className="chip">{u}://</code>)}</p>
          </>
        )}
        {r.documentTypes.length > 0 && (
          <>
            <h3>Files it opens</h3>
            <p className="muted wrap">{r.documentTypes.slice(0, 30).join(", ")}</p>
          </>
        )}
      </div>
    </div>
  );
}

function HistoryTab({ r }: { r: Report }) {
  const [data, setData] = useState<{ snapshots: { version?: string; takenAt: number }[]; changes: ChangeEvent[] } | null>(null);
  useEffect(() => {
    api.history(r.path).then(setData).catch(() => setData({ snapshots: [], changes: [] }));
  }, [r.path]);
  if (!data) return <p className="muted">Loading history.</p>;
  return (
    <div className="cols">
      <div>
        <h3>What changed between versions</h3>
        {data.changes.length === 0 && (
          <p className="muted">No updates recorded yet. Teardown took its first snapshot of {r.name}{data.snapshots[0] ? ` ${when(data.snapshots[0].takenAt)}` : ""}, and will compare the next version against it.</p>
        )}
        {data.changes.map((ev) => (
          <div key={ev.id} className="history-event">
            <p className="history-head"><strong>{ev.from ?? "?"} to {ev.to ?? "?"}</strong> <span className="muted">{when(ev.detectedAt)}</span></p>
            <ChangeList event={ev} />
          </div>
        ))}
      </div>
      <div>
        <h3>Snapshots</h3>
        <ul className="helpers">
          {data.snapshots.slice().reverse().map((s) => (
            <li key={s.takenAt}><span>Version {s.version ?? "unknown"}</span><span className="muted">{new Date(s.takenAt).toLocaleString()}</span></li>
          ))}
          {data.snapshots.length === 0 && <li className="muted">None yet.</li>}
        </ul>
      </div>
    </div>
  );
}

export function StackDot({ stack }: { stack: Report["stack"] }) {
  return <span className="dot" style={{ background: STACK_COLOR[stack] }} title={STACK_NAME[stack]} />;
}
