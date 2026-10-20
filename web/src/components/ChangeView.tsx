import { ArrowLeft, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChangeEvent, Fingerprint, SavedVersion } from "../../../shared/types";
import { api } from "../api";
import { DiffPlate } from "./DiffPlate";
import { ChangeList, when } from "./Changes";
import { EdgePrint } from "./Measure";
import { Button, Dialog } from "./ui";

interface Data {
  event: ChangeEvent;
  before?: Fingerprint;
  after?: Fingerprint;
  versions: SavedVersion[];
}

// One sentence from the changes that matter most, written from the recorded facts.
function headline(ev: ChangeEvent) {
  const notable = ev.changes.filter((c) => c.severity === "notable").map((c) => c.title.charAt(0).toLowerCase() + c.title.slice(1));
  const name = `${ev.name}${ev.to ? ` ${ev.to}` : ""}`;
  if (!notable.length) return `${name} changed, but nothing that loosens your privacy or security.`;
  if (notable.length === 1) return `${name}: ${notable[0]}.`;
  return `${name}: ${notable.slice(0, -1).slice(0, 2).join(", ")} and ${notable[Math.min(notable.length - 1, 2)]}.`;
}

export function ChangeView({ id }: { id: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    api.change(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="empty"><p>{error}</p><a className="btn btn-ghost" href="#/changes">Back to Changes</a></div>;
  if (!data) return <div className="scanning"><div className="scan-ring" aria-hidden /><p>Loading the change</p></div>;

  const { event: ev, before, after, versions } = data;
  // The newest saved copy that isn't what's installed now is the one to go back to.
  const target = versions.find((v) => !v.current && v.version && v.version !== ev.to) ?? versions.find((v) => !v.current);

  const roll = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await api.rollback(ev.path, target.savedAt);
      setDone(`Back on ${r.version ?? "the earlier version"}. The newer one is in the Trash.`);
      setConfirm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="teardown change-view">
      <a className="back-link" href="#/changes"><ArrowLeft size={15} aria-hidden /> Changes</a>
      <EdgePrint items={["TEARDOWN", "DIFF", ev.bundleId, ev.from && ev.to ? `${ev.from} > ${ev.to}` : ev.to, `DETECTED ${new Date(ev.detectedAt).toLocaleString("en-GB")}`]} />
      <header className="td-head">
        <img className="td-icon" src={api.icon(ev.path)} alt="" width={64} height={64} />
        <div className="td-title">
          <h1>{ev.name}</h1>
          <p className="td-meta"><code>{ev.from ?? "?"}</code><span className="diff-arrow">to</span><code className="diff-to">{ev.to ?? "?"}</code><span>{when(ev.detectedAt)}</span></p>
        </div>
      </header>

      <div className="diff-grid">
        {after?.tree ? <DiffPlate before={before?.tree} after={after.tree} label={ev.to ?? ""} /> : <div className="lightbox diff-plate"><p className="diff-note">No size map was recorded for this version.</p></div>}
        <section>
          <p className="verdict-lead diff-verdict">{headline(ev)}</p>
          <ChangeList event={ev} />
        </section>
      </div>

      {done ? (
        <div className="result-strip" role="status"><p>{done}</p><a className="btn btn-ghost" href={`#/app/${encodeURIComponent(ev.path)}`}>Open the app's teardown</a></div>
      ) : (
        <div className="action-bar diff-actions" role="region" aria-label="What to do">
          <p>
            {target
              ? <><strong>{target.version ?? "An earlier version"} is still here.</strong> Teardown kept a copy when it recorded it, so rolling back takes a second.</>
              : <>Teardown didn't have a saved copy from before this update. Copies are kept from now on, so the next update can be undone.</>}
          </p>
          <a className="btn btn-ghost" href={`#/app/${encodeURIComponent(ev.path)}`}>Open the evidence</a>
          {target && <Button variant="primary" icon={RotateCcw} onClick={() => setConfirm(true)}>Roll back to {target.version ?? "earlier version"}</Button>}
        </div>
      )}

      <Dialog
        open={confirm}
        title={`Roll ${ev.name} back to ${target?.version ?? "the earlier version"}?`}
        onClose={() => setConfirm(false)}
        actions={<><Button variant="quiet" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="primary" icon={RotateCcw} busy={busy} onClick={roll}>Roll back</Button></>}
      >
        <p>{ev.name} needs to be closed. The current version moves to the Trash, and the saved copy takes its place. The app may offer to update again; Teardown will flag it if it does.</p>
      </Dialog>
    </article>
  );
}
