import { Activity, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { LiveSnapshot } from "../../../shared/types";
import { api } from "../api";
import { Button, Empty, PageHeader } from "./ui";

const PORTS: Record<number, string> = { 443: "HTTPS", 80: "HTTP", 5228: "Google push", 5223: "Apple push", 993: "Mail", 3478: "Calls", 19302: "Calls" };

export function Live({ onOpen }: { onOpen: (path: string) => void }) {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    const load = () => api.live().then((s) => alive && setSnap(s)).catch(() => {});
    load();
    const t = setInterval(load, 4_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [paused]);

  const online = snap?.apps.filter((a) => a.connections.length) ?? [];
  const listeners = snap?.apps.filter((a) => !a.connections.length && a.listening.length) ?? [];
  const total = online.reduce((n, a) => n + a.connections.length, 0);

  return (
    <article className="page">
      <PageHeader
        title="Live"
        lede="Apps talking to the internet right now, checked against the web addresses written into their code. Refreshes every few seconds."
        actions={<Button icon={paused ? Play : Pause} onClick={() => setPaused(!paused)}>{paused ? "Resume" : "Pause"}</Button>}
      />

      {snap && (
        <p className="live-summary">
          <span className={`pulse${paused ? "" : " on"}`} aria-hidden />
          {online.length === 0 ? "No apps are connected right now." : `${online.length} app${online.length === 1 ? " has" : "s have"} ${total} open connection${total === 1 ? "" : "s"}.`}
          <span className="muted"> Updated {new Date(snap.at).toLocaleTimeString()}</span>
        </p>
      )}

      {snap && online.length === 0 && listeners.length === 0 && (
        <Empty icon={Activity} title="Nothing is online">
          <p>Open an app and its connections show up here within a few seconds.</p>
        </Empty>
      )}

      <div className="live-list">
        {online.map((a) => {
          const inCode = a.connections.filter((c) => c.mentioned).length;
          return (
            <section key={a.path} className="live-app">
              <button className="event-head" onClick={() => onOpen(a.path)}>
                <img src={api.icon(a.path)} width={32} height={32} alt="" />
                <span className="event-title">
                  <strong>{a.name}</strong>
                  <span className="muted">
                    {a.connections.length} connection{a.connections.length === 1 ? "" : "s"}
                    {a.mentionedTotal !== undefined && `, ${inCode} to addresses in its code`}
                  </span>
                </span>
              </button>
              <ul className="conn-list">
                {a.connections.map((c) => (
                  <li key={`${c.remote}:${c.port}`}>
                    <span className={`conn-dot${c.mentioned ? " known" : ""}`} aria-hidden />
                    <code className="conn-host" title={c.remote}>{c.host ?? c.remote}</code>
                    <span className="muted conn-port">{PORTS[c.port] ?? `port ${c.port}`}</span>
                    <span className="muted conn-proc">{c.process}</span>
                    {c.mentioned && <span className="conn-tag">In its code</span>}
                  </li>
                ))}
              </ul>
              {a.listening.length > 0 && <p className="muted conn-listen">Also accepting connections on {a.listening.join(", ")}</p>}
            </section>
          );
        })}
      </div>

      {listeners.length > 0 && (
        <section className="live-quiet">
          <h2 className="panel-title">Listening, but not talking</h2>
          <p className="muted">{listeners.map((a) => `${a.name} (${a.listening.join(", ")})`).join("; ")}</p>
        </section>
      )}

      <p className="note">
        Teardown can see every app you opened. It matches each connection to a name through reverse DNS, so big services often show up under their cloud provider's name.
      </p>
    </article>
  );
}
