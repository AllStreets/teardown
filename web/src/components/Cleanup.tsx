import { FolderOpen, RotateCw, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { CleanupCategory, CleanupItem, CleanupScan, TrashResult } from "../../../shared/types";
import { api } from "../api";
import { bytes } from "../format";
import { Button, Checkbox, Dialog, Empty, PageHeader } from "./ui";
import { MeasuredStrip } from "./Measure";

const GROUPS: { category: CleanupCategory; title: string; blurb: string }[] = [
  { category: "caches", title: "Caches that rebuild themselves", blurb: "Apps and developer tools recreate these as needed. The only cost is a slower first launch or build." },
  { category: "stale-apps", title: "Apps you've stopped using", blurb: "Judged by the last time the app touched its own data. Your documents stay where they are." },
  { category: "leftovers", title: "Left behind by deleted apps", blurb: "Settings, caches and data for apps that are no longer installed." },
  { category: "broken-login-items", title: "Broken login items", blurb: "Startup entries that point at programs which no longer exist." },
];

const SHORT: Record<string, string> = { caches: "Caches", "stale-apps": "Unused apps", leftovers: "Leftovers", "broken-login-items": "Login items" };

const GROUP_COLOR: Record<string, string> = {
  caches: "#58E1C1",
  "stale-apps": "#4F7CFF",
  leftovers: "#C08BFF",
  "broken-login-items": "#FF8FD1",
};

export function Cleanup({ scan, onScan }: { scan: CleanupScan | null; onScan: (s: CleanupScan) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [moving, setMoving] = useState(false);
  const [results, setResults] = useState<TrashResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = scan?.items ?? [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const chosen = [...picked].map((id) => byId.get(id)).filter(Boolean) as CleanupItem[];
  const chosenBytes = chosen.reduce((a, i) => a + i.bytes, 0);
  const total = items.filter((i) => i.removable).reduce((a, i) => a + i.bytes, 0);
  const intel = items.filter((i) => i.category === "intel-only");

  const rescan = async () => {
    setScanning(true);
    setError(null);
    try {
      onScan(await api.cleanup(true));
      setPicked(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const toggle = (ids: string[], on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const move = async () => {
    setMoving(true);
    try {
      const r = await api.trash([...picked]);
      setResults(r);
      setPicked(new Set());
      setConfirm(false);
      onScan(await api.cleanup());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMoving(false);
    }
  };

  const freed = results?.filter((r) => r.ok).reduce((a, r) => a + r.bytes, 0) ?? 0;
  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <article className="page cleanup">
      <PageHeader
        title="Clean up"
        edge={["TEARDOWN", "CLEAN UP", scan && `${items.filter((i) => i.removable).length} ITEMS`, scan && bytes(total), scan && `SCANNED ${(scan.ms / 1000).toFixed(1)}S`]}
        lede="Space you can get back, found by checking what's on this Mac against the apps that are actually installed. Everything goes to the Trash, so you can put it back."
        actions={<Button icon={RotateCw} busy={scanning} onClick={rescan}>{scanning ? "Scanning" : "Scan again"}</Button>}
      />

      {!scan && !error && (
        <div className="scanning small" aria-live="polite">
          <div className="scan-ring" aria-hidden />
          <p>Looking for space you can get back</p>
        </div>
      )}
      {error && <p className="error-line">{error}</p>}

      {results && (
        <div className="result-strip" role="status">
          <p>
            {freed > 0 ? `Moved ${results.length - failed.length} item${results.length - failed.length === 1 ? "" : "s"} to the Trash, ${bytes(freed)} in all.` : "Nothing was moved."}
            {failed.length > 0 && <span className="muted"> {failed.length} couldn't be moved.</span>}
          </p>
          <Button icon={FolderOpen} onClick={() => api.openFolder("trash")}>Open Trash</Button>
          {failed.length > 0 && (
            <ul className="fail-list">
              {failed.map((f) => <li key={f.id}><code>{f.path.split("/").pop()}</code> <span className="muted">{f.error}</span></li>)}
            </ul>
          )}
        </div>
      )}

      {scan && (
        <p className="cleanup-total">
          <span className="cleanup-number">{bytes(total)}</span>
          <span className="muted">could be freed across {items.filter((i) => i.removable).length} items. Scanned in {(scan.ms / 1000).toFixed(1)} seconds.</span>
        </p>
      )}

      {scan && total > 0 && (
        <div className="plate-band">
          <MeasuredStrip
            unit={bytes}
            labelled={4}
            segments={GROUPS.map((g) => ({ key: g.category, label: SHORT[g.category], value: items.filter((i) => i.category === g.category).reduce((a, i) => a + i.bytes, 0), color: GROUP_COLOR[g.category] }))
              .filter((sg) => sg.value > 0)}
          />
        </div>
      )}

      {scan && items.length === 0 && (
        <Empty icon={Sparkles} title="This Mac is already tidy">
          <p>No leftovers, oversized caches or long-unused apps turned up.</p>
        </Empty>
      )}

      {GROUPS.map((g) => {
        const list = items.filter((i) => i.category === g.category);
        if (!list.length) return null;
        const ids = list.map((i) => i.id);
        const on = ids.filter((id) => picked.has(id)).length;
        const sum = list.reduce((a, i) => a + i.bytes, 0);
        return (
          <section key={g.category} className="clean-group" aria-label={g.title}>
            <header className="clean-head">
              <Checkbox label={`Select all ${g.title.toLowerCase()}`} checked={on === ids.length} indeterminate={on > 0 && on < ids.length} onChange={(v) => toggle(ids, v)} />
              <div>
                <h2 className="panel-title">{g.title}</h2>
                <p className="panel-desc">{g.blurb}</p>
              </div>
              <span className="clean-sum">{bytes(sum)}</span>
            </header>
            <ul className="clean-list">
              {list.map((i) => (
                <li key={i.id} className={picked.has(i.id) ? "picked" : undefined}>
                  <label>
                    <Checkbox label={`Select ${i.label}`} checked={picked.has(i.id)} onChange={(v) => toggle([i.id], v)} />
                    {i.category === "stale-apps" && <img src={api.icon(i.path)} width={24} height={24} alt="" />}
                    <span className="clean-text">
                      <span className="clean-label">{i.label}</span>
                      <span className="muted clean-detail">{i.detail}</span>
                      <code className="clean-path">{i.path.replace(/^\/Users\/[^/]+/, "~")}</code>
                    </span>
                    <span className="clean-size">{bytes(i.bytes)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {intel.length > 0 && (
        <section className="clean-group info-only" aria-label="Intel-only apps">
          <header className="clean-head">
            <span />
            <div>
              <h2 className="panel-title">Still Intel-only</h2>
              <p className="panel-desc">Not something to delete, but these run through Rosetta translation. A native Apple silicon version is usually faster and easier on the battery.</p>
            </div>
            <span className="clean-sum">{intel.length} apps</span>
          </header>
          <p className="chips">
            {intel.map((i) => <span key={i.id} className="chip">{i.label}</span>)}
          </p>
        </section>
      )}

      {chosen.length > 0 && (
        <div className="action-bar" role="region" aria-label="Selection">
          <p><strong>{chosen.length}</strong> selected, <strong>{bytes(chosenBytes)}</strong></p>
          <Button variant="quiet" onClick={() => setPicked(new Set())}>Clear</Button>
          <Button variant="danger" icon={Trash2} onClick={() => setConfirm(true)}>Move to Trash</Button>
        </div>
      )}

      <Dialog
        open={confirm}
        title={`Move ${chosen.length} item${chosen.length === 1 ? "" : "s"} to the Trash?`}
        onClose={() => setConfirm(false)}
        actions={
          <>
            <Button variant="quiet" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" icon={Trash2} busy={moving} onClick={move}>Move {bytes(chosenBytes)} to Trash</Button>
          </>
        }
      >
        <p>Nothing is deleted until you empty the Trash. Apps that are open will be skipped.</p>
        <ul className="confirm-list">
          {chosen.slice(0, 8).map((i) => <li key={i.id}><span>{i.label}</span><span className="muted">{bytes(i.bytes)}</span></li>)}
          {chosen.length > 8 && <li className="muted">and {chosen.length - 8} more</li>}
        </ul>
      </Dialog>
    </article>
  );
}
