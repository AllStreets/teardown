import { Power, RotateCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { StartupItem } from "../../../shared/types";
import { api } from "../api";
import { Button, Dialog, PageHeader, Toggle } from "./ui";

const GROUPS: { scope: StartupItem["scope"]; title: string; blurb: string }[] = [
  { scope: "user", title: "Starts when you log in", blurb: "Background programs installed for your account. Switching one off stops it and keeps it off after a restart; switching it on undoes both." },
  { scope: "system-agent", title: "Starts for every user", blurb: "Installed for the whole Mac. macOS asks for your password to change these." },
  { scope: "system-daemon", title: "Runs before anyone logs in", blurb: "System services that run as root. macOS asks for your password to change these." },
];

export function Startup({ onOpen }: { onOpen: (path: string) => void }) {
  const [items, setItems] = useState<StartupItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ item: StartupItem; enable: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.startup());
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const apply = async (item: StartupItem, enable: boolean) => {
    setBusy(item.plist);
    setNote(null);
    try {
      const fresh = await api.toggleStartup(item.plist, enable);
      setItems((list) => list?.map((i) => (i.plist === item.plist && fresh ? fresh : i)) ?? null);
      setNote(`${item.label} is ${enable ? "on" : "off"}.${enable ? "" : " Switch it back on any time."}`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const on = (i: StartupItem) => !i.disabled;
  const flip = (item: StartupItem, enable: boolean) => (item.scope === "user" ? apply(item, enable) : setConfirm({ item, enable }));
  const active = items?.filter((i) => on(i) && !i.missing).length ?? 0;

  return (
    <article className="page">
      <PageHeader
        title="Startup"
        edge={["TEARDOWN", "STARTUP", items && `${items.length} ITEMS`, items && `${active} ACTIVE`, items && `${items.filter((i) => i.missing).length} BROKEN`]}
        lede="Everything apps have set to run in the background or at login, and what it belongs to. Switch off what you don't want; nothing is deleted, so anything can be switched back on."
        actions={<Button icon={RotateCw} busy={loading} onClick={load}>Refresh</Button>}
      />

      {note && <div className="result-strip" role="status"><p>{note}</p></div>}

      {GROUPS.map((g) => {
        const list = items?.filter((i) => i.scope === g.scope) ?? [];
        if (!list.length) return null;
        return (
          <section key={g.scope} className="clean-group" aria-label={g.title}>
            <header className="clean-head">
              <span />
              <div>
                <h2 className="panel-title">{g.title}</h2>
                <p className="panel-desc">{g.blurb}</p>
              </div>
              <span className="clean-sum">{list.length}</span>
            </header>
            <ul className="startup-list">
              {list.map((i) => (
                <li key={i.plist} className={on(i) ? undefined : "is-off"}>
                  <button className="perm-app" onClick={() => i.app && onOpen(i.app.path)} disabled={!i.app}>
                    {i.app ? <img src={api.icon(i.app.path)} width={26} height={26} alt="" /> : <span className="startup-blank"><Power size={14} aria-hidden /></span>}
                    <span className="clean-text">
                      <span className="clean-label">{i.app ? `${i.app.name}` : i.label}{i.app && <span className="muted startup-label"> {i.label}</span>}</span>
                      <code className="clean-path">{i.program ?? i.plist}</code>
                      <span className="startup-tags">
                        {i.missing && <span className="tag warn">Program is gone</span>}
                        {!i.missing && on(i) && i.loaded && <span className="tag ok">Running</span>}
                        {!on(i) && <span className="tag">Switched off</span>}
                        {i.runAtLoad && <span className="tag">Starts at login</span>}
                        {i.keepAlive && <span className="tag">Restarts itself</span>}
                      </span>
                    </span>
                  </button>
                  <Toggle label={`${on(i) ? "Switch off" : "Switch on"} ${i.label}`} checked={on(i)} onChange={(v) => busy || flip(i, v)} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <Dialog
        open={!!confirm}
        title={`${confirm?.enable ? "Switch on" : "Switch off"} ${confirm?.item.label}?`}
        onClose={() => setConfirm(null)}
        actions={<><Button variant="quiet" onClick={() => setConfirm(null)}>Cancel</Button><Button variant={confirm?.enable ? "primary" : "danger"} busy={!!busy} onClick={() => confirm && apply(confirm.item, confirm.enable)}>{confirm?.enable ? "Switch on" : "Switch off"}</Button></>}
      >
        <p>This runs for the whole Mac, so macOS will ask for your password. {confirm?.enable ? "It will start again right away." : "It stops now and stays off after a restart. The app it belongs to may stop updating itself or lose a feature until you switch it back on."}</p>
      </Dialog>
    </article>
  );
}
