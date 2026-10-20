import { CircleCheck, CircleAlert, ExternalLink, FolderOpen, RotateCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AppEntry, SelfConnections, Settings, StorageInfo } from "../../../shared/types";
import { api } from "../api";
import { bytes } from "../format";
import { Button, Dialog, PageHeader, Section, Select, SettingRow, Toggle } from "./ui";

const TOC = [
  { id: "watching", label: "Watching" },
  { id: "cleanup", label: "Clean up" },
  { id: "hidden", label: "Hidden apps" },
  { id: "privacy", label: "Privacy policy" },
  { id: "data", label: "Data on this Mac" },
  { id: "connections", label: "Connections" },
  { id: "about", label: "About" },
];

const TOOLS: [string, string][] = [
  ["codesign, spctl", "who signed an app, and whether Apple notarized it"],
  ["otool, lipo", "which libraries an app links and which processors it supports"],
  ["plutil", "reading each app's Info.plist"],
  ["grep, du", "finding web addresses in code, measuring folder sizes"],
  ["mdls", "when you last used an app, from Spotlight"],
  ["lsof, ps", "which apps have network connections open (Live page)"],
  ["sips", "turning app icons into images"],
  ["open, osascript", "Show in Finder, and asking Finder to move protected items to the Trash"],
];

export function SettingsPage({ settings, onChange, apps }: { settings: Settings | null; onChange: (s: Settings) => void; apps: AppEntry[] }) {
  const [hideQuery, setHideQuery] = useState("");
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [self, setSelf] = useState<(SelfConnections & { version: string }) | null>(null);
  const [checking, setChecking] = useState(false);
  const [clearing, setClearing] = useState<"cache" | "history" | null>(null);
  const [confirm, setConfirm] = useState<"cache" | "history" | null>(null);

  const loadStorage = useCallback(() => api.storage().then(setStorage).catch(() => {}), []);
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setSelf(await api.self());
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    loadStorage();
    check();
  }, [loadStorage, check]);

  const save = async (patch: Partial<Settings>) => onChange(await api.saveSettings(patch));

  const clear = async (what: "cache" | "history") => {
    setClearing(what);
    try {
      await api.clear(what);
      await loadStorage();
    } finally {
      setClearing(null);
      setConfirm(null);
    }
  };

  return (
    <article className="page settings">
      <PageHeader edge={["TEARDOWN", "SETTINGS", self && `v${self.version}`, self && `ENGINE PID ${self.pid}`, self && `${self.outbound.length} OUTBOUND`]} title="Settings" lede="How Teardown watches your apps, what it keeps on this Mac, and proof that nothing leaves it." />

      <div className="settings-layout">
        <nav className="toc" aria-label="Settings sections">
          {TOC.map((t) => <a key={t.id} href={`#/settings`} onClick={(e) => { e.preventDefault(); document.getElementById(t.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{t.label}</a>)}
        </nav>

        <div className="settings-body">
          {settings && (
            <>
              <Section id="watching" title="Watching" description="Teardown snapshots each app and compares versions when they update.">
                <SettingRow label="Watch for app updates" description="Checks in the background while Teardown is open. Reading an app takes a few seconds and happens one app at a time.">
                  <Toggle label="Watch for app updates" checked={settings.watch} onChange={(v) => save({ watch: v })} />
                </SettingRow>
                <SettingRow label="Check every" description="Teardown only rereads apps whose files changed, so frequent checks are cheap.">
                  <Select label="Check interval" value={settings.intervalMinutes} onChange={(v) => save({ intervalMinutes: v })} options={[
                    { value: 15, label: "15 minutes" }, { value: 30, label: "30 minutes" }, { value: 60, label: "Hour" }, { value: 360, label: "6 hours" }, { value: 1440, label: "Day" },
                  ]} />
                </SettingRow>
                <SettingRow label="Include apps that come with macOS" description="Apple's own apps, like Notes and Safari, in the sidebar and in watching.">
                  <Toggle label="Include macOS apps" checked={settings.includeSystem} onChange={(v) => save({ includeSystem: v })} />
                </SettingRow>
              </Section>

              <Section id="cleanup" title="Clean up" description="Nothing is ever deleted directly. Items go to the Trash, where you can put them back.">
                <SettingRow label="Call an app unused after" description="Measured from the last time the app wrote to its own data folders.">
                  <Select label="Unused after" value={settings.staleDays} onChange={(v) => save({ staleDays: v })} options={[
                    { value: 90, label: "3 months" }, { value: 180, label: "6 months" }, { value: 365, label: "1 year" }, { value: 730, label: "2 years" },
                  ]} />
                </SettingRow>
              </Section>
            </>
          )}

          {settings && (
            <Section id="hidden" title="Hidden apps" description="Apps you'd rather Teardown left alone. They disappear from every page, including Live and Clean up, and their data is never offered for deletion.">
              <SettingRow label="Hide an app" description="Start typing a name, then pick it from the list.">
                <form className="hide-form" onSubmit={(e) => {
                  e.preventDefault();
                  const hit = apps.find((a) => a.name.toLowerCase() === hideQuery.trim().toLowerCase());
                  if (hit) {
                    save({ hiddenApps: [...settings.hiddenApps, hit.path] });
                    setHideQuery("");
                  }
                }}>
                  <input className="text-input" list="hide-apps" value={hideQuery} onChange={(e) => setHideQuery(e.target.value)} placeholder="App name" aria-label="App to hide" />
                  <datalist id="hide-apps">
                    {apps.filter((a) => !settings.hiddenApps.includes(a.path)).map((a) => <option key={a.path} value={a.name} />)}
                  </datalist>
                  <Button type="submit" disabled={!apps.some((a) => a.name.toLowerCase() === hideQuery.trim().toLowerCase())}>Hide</Button>
                </form>
              </SettingRow>
              {settings.hiddenApps.length === 0 && <p className="muted hidden-empty">Nothing hidden.</p>}
              <ul className="hidden-list">
                {settings.hiddenApps.map((p) => (
                  <li key={p}>
                    <span>{apps.find((a) => a.path === p)?.name ?? p.split("/").pop()?.replace(/\.app$/, "")}</span>
                    <code className="muted">{p}</code>
                    <Button variant="quiet" onClick={() => save({ hiddenApps: settings.hiddenApps.filter((x) => x !== p) })}>Show again</Button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section id="privacy" title="Privacy policy" description="Last updated October 2026. Plain language, because there isn't much to say.">
            <div className="policy">
              <h3>The short version</h3>
              <p>Teardown runs entirely on your Mac. It has no account, no analytics, no crash reporting and no server. It never sends anything about you or your apps anywhere.</p>
              <h3>What it reads</h3>
              <p>The app bundles in your Applications folders, the folders apps keep in your Library, your login items, and the list of network connections open on this Mac. It reads files and runs Apple's own command line tools. It never opens, launches or modifies the apps it inspects.</p>
              <h3>What it keeps</h3>
              <p>Reports about each app, snapshots used to spot changes between versions, app icons, your settings, and a log of what you moved to the Trash. All of it lives in one folder, listed below, and nowhere else.</p>
              <h3>What it sends</h3>
              <p>Nothing. The window and the engine talk to each other over this Mac's own loopback address. To label connections on the Live page, Teardown asks your Mac's usual DNS resolver for the names and addresses of servers your apps reference or already talk to. That is the only network traffic it causes, and it contains nothing about you.</p>
              <h3>What it changes</h3>
              <p>Only what you choose on the Clean up page, and only by moving it to the Trash. If an item is protected, macOS asks you before Finder moves it.</p>
              <h3>Deleting your data</h3>
              <p>Use the buttons below, or delete the folder. Uninstalling Teardown and removing that folder leaves no trace.</p>
            </div>
          </Section>

          <Section id="data" title="Data on this Mac" description={storage ? <code>{storage.dataDir.replace(/^\/Users\/[^/]+/, "~")}</code> : "Loading"}>
            <SettingRow label="App reports and icons" description={storage ? `${storage.reports.files + storage.icons.files} files, ${bytes(storage.reports.bytes + storage.icons.bytes)}. Rebuilt automatically the next time you look at an app.` : undefined}>
              <Button icon={Trash2} onClick={() => setConfirm("cache")} busy={clearing === "cache"}>Clear</Button>
            </SettingRow>
            <SettingRow label="Snapshots and change history" description={storage ? `${storage.snapshots.files} snapshots, ${bytes(storage.snapshots.bytes)}, plus ${storage.cleanupLog} clean up records. Deleting these resets the Changes page.` : undefined}>
              <Button variant="danger" icon={Trash2} onClick={() => setConfirm("history")} busy={clearing === "history"}>Delete</Button>
            </SettingRow>
            <SettingRow label="Settings" description="Your choices on this page, in settings.json." />
            <SettingRow label="Open the folder" description="Everything Teardown has ever written is in here.">
              <Button icon={FolderOpen} onClick={() => api.openFolder("data")}>Show in Finder</Button>
            </SettingRow>
          </Section>

          <Section id="connections" title="Connections" description="Teardown audits itself with the same engine it uses on every other app.">
            <div className="self-check">
              {self && self.outbound.length === 0 ? (
                <CircleCheck size={22} aria-hidden className="ok" />
              ) : (
                <CircleAlert size={22} aria-hidden className="warn" />
              )}
              <div>
                <p className="self-title">
                  {self ? (self.outbound.length === 0 ? "No connections to the internet" : `${self.outbound.length} outbound connection${self.outbound.length === 1 ? "" : "s"}`) : "Checking"}
                </p>
                <p className="muted">
                  {self ? `Engine process ${self.pid} is only listening on 127.0.0.1 port ${self.port}, which nothing outside this Mac can reach. Checked ${new Date(self.checkedAt).toLocaleTimeString()}.` : ""}
                </p>
                {self && self.outbound.length > 0 && (
                  <ul className="conn-list">
                    {self.outbound.map((c) => <li key={`${c.remote}:${c.port}`}><code className="conn-host">{c.remote}</code><span className="muted conn-port">port {c.port}</span></li>)}
                  </ul>
                )}
              </div>
              <Button icon={RotateCw} busy={checking} onClick={check}>Check again</Button>
            </div>
            <h3 className="sub-title">Tools it runs</h3>
            <dl className="tool-list">
              {TOOLS.map(([t, why]) => (
                <div key={t}><dt><code>{t}</code></dt><dd>{why}</dd></div>
              ))}
            </dl>
          </Section>

          <Section id="about" title="About">
            <SettingRow label="Teardown" description={`Version ${self?.version ?? ""}. Open source under the MIT license.`}>
              <a className="btn btn-ghost" href="https://github.com/AllStreets/teardown" target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden />Source on GitHub</a>
            </SettingRow>
          </Section>
        </div>
      </div>

      <Dialog
        open={confirm !== null}
        title={confirm === "history" ? "Delete snapshots and change history?" : "Clear app reports and icons?"}
        onClose={() => setConfirm(null)}
        actions={
          <>
            <Button variant="quiet" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" icon={Trash2} busy={clearing !== null} onClick={() => confirm && clear(confirm)}>{confirm === "history" ? "Delete history" : "Clear"}</Button>
          </>
        }
      >
        <p>
          {confirm === "history"
            ? "Teardown will forget how your apps looked before. It starts recording again right away, but past changes can't be recovered."
            : "Reports and icons are rebuilt the next time you open an app. Nothing else is affected."}
        </p>
      </Dialog>
    </article>
  );
}
