import { CircleAlert, CircleCheck, CircleDot, ExternalLink, History, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Arrival, ChangeEvent, Severity, WatchStatus } from "../../../shared/types";
import { api } from "../api";
import { Button, Dialog, Empty, Meter, PageHeader } from "./ui";

export const SEVERITY_ICON: Record<Severity, typeof CircleDot> = { notable: CircleAlert, info: CircleDot, good: CircleCheck };

export function when(t: number) {
  const d = Date.now() - t;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function ChangeList({ event }: { event: ChangeEvent }) {
  return (
    <ul className="change-list">
      {event.changes.map((c, i) => {
        const Icon = SEVERITY_ICON[c.severity];
        return (
          <li key={i} className={`finding ${c.severity}`}>
            <Icon size={17} aria-hidden className="finding-icon" />
            <div>
              <p className="finding-title">{c.title}</p>
              {c.detail && <p className="finding-detail">{c.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Changes({ onOpen }: { onOpen: (path: string) => void }) {
  const [events, setEvents] = useState<ChangeEvent[] | null>(null);
  const [status, setStatus] = useState<WatchStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.changes().then((r) => {
      if (!alive) return;
      setEvents(r.events);
      setStatus(r.status);
    }).catch(() => {});
    load();
    const t = setInterval(load, 3_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const busy = !!status && status.queue > 0;

  return (
    <article className="page">
      <PageHeader
        title="Changes"
        edge={["TEARDOWN", "CHANGES", status && `${status.baselined}/${status.total} RECORDED`, events && `${events.length} UPDATES`, new Date().toISOString().slice(0, 10)]}
        lede="Teardown keeps a snapshot of every app. When one updates, it compares the new version with the last one and shows what changed underneath, things release notes leave out."
        actions={<Button icon={RotateCw} busy={busy} onClick={() => api.checkNow().then(setStatus)}>{busy ? "Checking" : "Check now"}</Button>}
      />

      {status && (
        <div className="watch-strip">
          <span className={`pulse${status.watching ? " on" : ""}`} aria-hidden />
          <p>
            {status.watching ? "Watching" : "Watching is off"}
            <span className="muted">
              {" "}
              {busy
                ? `Recording ${status.current ?? "apps"}, ${status.queue} to go`
                : `${status.baselined} of ${status.total} apps recorded${status.lastCheck ? `, checked ${when(status.lastCheck)}` : ""}`}
            </span>
          </p>
          <Meter value={status.baselined} max={status.total} />
        </div>
      )}

      <Arrivals onOpen={onOpen} />

      {events && events.length === 0 && (
        <Empty icon={History} title="No updates yet">
          <p>The first pass records how every app looks today. The next time one of them updates, the differences land here: new trackers, new permission requests, a different developer signing it.</p>
        </Empty>
      )}

      <ol className="timeline">
        {events?.map((ev) => (
          <li key={ev.id} className="event">
            <button className="event-head" onClick={() => (location.hash = `#/change/${ev.id}`)}>
              <img src={api.icon(ev.path)} width={36} height={36} alt="" />
              <span className="event-title">
                <strong>{ev.name}</strong>
                <span className="muted">{ev.from && ev.to && ev.from !== ev.to ? `${ev.from} to ${ev.to}` : ev.to ? `Version ${ev.to}` : "Rebuilt"}</span>
              </span>
              <time className="muted" dateTime={new Date(ev.detectedAt).toISOString()}>{when(ev.detectedAt)}</time>
            </button>
            <ChangeList event={ev} />
          </li>
        ))}
      </ol>
    </article>
  );
}

// Apps that arrived but have never been opened, read before their first launch.
function Arrivals({ onOpen }: { onOpen: (path: string) => void }) {
  const [list, setList] = useState<Arrival[]>([]);
  const [trash, setTrash] = useState<Arrival | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api.arrivals().then((a) => alive && setList(a)).catch(() => {});
    load();
    const t = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!list.length) return null;
  return (
    <section className="arrivals" aria-label="Not opened yet">
      <h2 className="panel-title">Not opened yet</h2>
      <p className="panel-desc">These apps arrived on your Mac but have never run. Teardown read them first, so you can decide before they do anything.</p>
      <ul>
        {list.map((a) => {
          const notable = a.findings.filter((f) => f.severity === "notable");
          return (
            <li key={a.path} className="arrival">
              <button className="event-head" onClick={() => onOpen(a.path)}>
                <img src={api.icon(a.path)} width={40} height={40} alt="" />
                <span className="event-title">
                  <strong>{a.name}{a.version ? ` ${a.version}` : ""}</strong>
                  <span className="muted">
                    {a.source ? `Downloaded with ${a.source}` : "Downloaded"}
                    {a.from?.[0] ? ` from ${new URL(a.from[0]).hostname}` : ""}
                    {a.quarantinedAt ? `, ${when(a.quarantinedAt)}` : ""}
                  </span>
                </span>
              </button>
              {a.verdict && <p className="arrival-verdict">{a.verdict}</p>}
              {notable.length > 0 && (
                <ul className="change-list">
                  {notable.slice(0, 3).map((f, i) => (
                    <li key={i} className="finding notable">
                      <CircleAlert size={17} aria-hidden className="finding-icon" />
                      <div><p className="finding-title">{f.title}</p><p className="finding-detail">{f.detail}</p></div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="arrival-actions">
                <Button variant="primary" icon={ExternalLink} onClick={() => api.openArrival(a.path)}>Open it</Button>
                <Button onClick={() => onOpen(a.path)}>Read the full teardown</Button>
                <Button variant="danger" icon={Trash2} onClick={() => setTrash(a)}>Move to Trash</Button>
              </div>
            </li>
          );
        })}
      </ul>
      <Dialog
        open={!!trash}
        title={`Move ${trash?.name} to the Trash?`}
        onClose={() => setTrash(null)}
        actions={<><Button variant="quiet" onClick={() => setTrash(null)}>Cancel</Button><Button variant="danger" icon={Trash2} busy={busy} onClick={async () => {
          if (!trash) return;
          setBusy(true);
          try {
            await api.trashArrival(trash.path);
            setList((l) => l.filter((x) => x !== trash));
            setTrash(null);
          } finally {
            setBusy(false);
          }
        }}>Move to Trash</Button></>}
      >
        <p>It has never been opened, so nothing of it has run. You can put it back from the Trash.</p>
      </Dialog>
    </section>
  );
}
