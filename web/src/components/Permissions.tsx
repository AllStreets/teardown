import { KeyRound, LockOpen, RotateCw, ShieldOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Grant, GrantsReport } from "../../../shared/types";
import { api } from "../api";
import { when } from "./Changes";
import { MeasuredStrip } from "./Measure";
import { Button, Dialog, Empty, PageHeader } from "./ui";

// Which permissions matter most, in the order people care about them.
const ORDER = ["ScreenCapture", "Microphone", "Camera", "ListenEvent", "Accessibility", "SystemPolicyAllFiles", "PostEvent", "AppleEvents", "AudioCapture", "AddressBook", "Photos", "Calendar"];
const rank = (s: string) => (ORDER.indexOf(s) < 0 ? 99 : ORDER.indexOf(s));
const SIX_MONTHS = 182 * 86_400_000;
const COLORS = ["#FFB547", "#FF8FD1", "#C08BFF", "#7FD3FF", "#4F7CFF", "#58E1C1", "#8EA2FF", "#FFE29A", "#3E7397"];

export function Permissions({ onOpen }: { onOpen: (path: string) => void }) {
  const [report, setReport] = useState<GrantsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Grant[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api.permissions());
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const granted = useMemo(() => (report?.grants ?? []).filter((g) => g.allowed), [report]);
  const groups = useMemo(() => {
    const m = new Map<string, Grant[]>();
    for (const g of granted) m.set(g.service, [...(m.get(g.service) ?? []), g]);
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length);
  }, [granted]);
  const stale = granted.filter((g) => !g.lastUsed || Date.now() - g.lastUsed > SIX_MONTHS);
  const revocable = (g: Grant) => /^[A-Za-z0-9.-]+$/.test(g.client) && !g.client.startsWith("/");

  const takeBack = async (list: Grant[]) => {
    setBusy(true);
    const kept: string[] = [];
    for (const g of list.filter(revocable)) {
      try {
        const r = await api.revoke(g.service, g.client);
        if (!r.ok) kept.push(`${g.app?.name}: ${g.label}`);
      } catch {
        kept.push(`${g.app?.name}: ${g.label}`);
      }
    }
    setBusy(false);
    setPending(null);
    setNote(kept.length ? `macOS kept ${kept.length}: ${kept.slice(0, 3).join("; ")}${kept.length > 3 ? " and more" : ""}. Those need System Settings.` : `Took back ${list.length} permission${list.length === 1 ? "" : "s"}. Each app has to ask again next time.`);
    load();
  };

  return (
    <article className="page">
      <PageHeader
        title="Permissions"
        edge={["TEARDOWN", "PERMISSIONS", report && `${granted.length} GRANTED`, report && `${stale.length} UNUSED 6 MONTHS`]}
        lede="What you've actually allowed each app to do, read from macOS's own permission records. Take any of it back; the app simply has to ask again."
        actions={<Button icon={RotateCw} busy={loading} onClick={load}>Refresh</Button>}
      />

      {report && !report.readable && (
        <Empty icon={KeyRound} title="Teardown can't read your permission records yet">
          <p>macOS keeps them behind Full Disk Access. Turn it on for Teardown in System Settings, then refresh. Teardown only reads them; it never changes a permission without you pressing a button.</p>
          <p style={{ marginTop: 12 }}><Button variant="primary" icon={LockOpen} onClick={() => api.openPrivacySettings()}>Open Full Disk Access settings</Button></p>
        </Empty>
      )}

      {note && <div className="result-strip" role="status"><p>{note}</p></div>}

      {granted.length > 0 && (
        <>
          <div className="plate-band">
            <MeasuredStrip unit={(v) => `${v} app${v === 1 ? "" : "s"}`} labelled={5}
              segments={groups.map(([svc, list], i) => ({ key: svc, label: list[0].label.split(" (")[0], value: list.length, color: COLORS[i % COLORS.length] }))} />
          </div>
          {stale.filter(revocable).length > 0 && (
            <div className="action-bar perm-bulk">
              <p><strong>{stale.filter(revocable).length} permissions</strong> belong to apps that haven't done anything in six months.</p>
              <Button variant="danger" icon={ShieldOff} onClick={() => setPending(stale.filter(revocable))}>Take them back</Button>
            </div>
          )}
        </>
      )}

      {groups.map(([svc, list]) => (
        <section key={svc} className="clean-group perm-group" aria-label={list[0].label}>
          <header className="clean-head">
            <span />
            <div>
              <h2 className="panel-title">{list[0].label}</h2>
              <p className="panel-desc">{list.length} app{list.length === 1 ? "" : "s"} allowed</p>
            </div>
            <span />
          </header>
          <ul className="perm-list">
            {list.map((g) => {
              const old = !g.lastUsed || Date.now() - g.lastUsed > SIX_MONTHS;
              return (
                <li key={`${g.service}:${g.client}`}>
                  <button className="perm-app" onClick={() => g.app && onOpen(g.app.path)}>
                    {g.app && <img src={api.icon(g.app.path)} width={26} height={26} alt="" />}
                    <span className="clean-text">
                      <span className="clean-label">{g.app?.name ?? g.client}</span>
                      <span className={`clean-detail ${old ? "perm-stale" : "muted"}`}>
                        {g.since ? `Allowed ${when(g.since)}` : "Allowed"}
                        {g.lastUsed ? `, last active ${when(g.lastUsed)}` : ", no recent activity found"}
                        {g.scope === "system" ? ", machine-wide" : ""}
                      </span>
                    </span>
                  </button>
                  {revocable(g) ? <Button onClick={() => setPending([g])}>Take back</Button> : <span className="muted perm-na">Change in System Settings</span>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <Dialog
        open={!!pending}
        title={pending?.length === 1 ? `Take back ${pending[0].label.toLowerCase()} from ${pending[0].app?.name}?` : `Take back ${pending?.length} permissions?`}
        onClose={() => setPending(null)}
        actions={<><Button variant="quiet" onClick={() => setPending(null)}>Cancel</Button><Button variant="danger" icon={ShieldOff} busy={busy} onClick={() => pending && takeBack(pending)}>Take back</Button></>}
      >
        <p>Teardown asks macOS to reset {pending?.length === 1 ? "this permission" : "these permissions"} with Apple's tccutil. Nothing is deleted; the app asks you again the next time it needs it.</p>
        {pending && pending.length > 1 && (
          <ul className="confirm-list">
            {pending.slice(0, 8).map((g) => <li key={`${g.service}:${g.client}`}><span>{g.app?.name}</span><span className="muted">{g.label.split(" (")[0]}</span></li>)}
            {pending.length > 8 && <li className="muted">and {pending.length - 8} more</li>}
          </ul>
        )}
      </Dialog>
    </article>
  );
}
