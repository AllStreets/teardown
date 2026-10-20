import type { AppEntry, QuickReport, Stack } from "../../../shared/types";
import { api } from "../api";
import { STACK_COLOR, STACK_NAME, bytes } from "../format";

const WRAPPER_STACKS: Stack[] = ["electron", "webview"];

interface Props {
  apps: AppEntry[];
  quick: Record<string, QuickReport>;
  onOpen: (path: string) => void;
  reclaim?: number;
}

export function Overview({ apps, quick, onOpen, reclaim }: Props) {
  // System apps are all Apple's; the interesting picture is what you installed.
  const mine = apps.filter((a) => a.location !== "system");
  const read = mine.map((a) => quick[a.path]).filter(Boolean) as QuickReport[];
  const done = read.length === mine.length;

  // Electron and web-view apps are a website plus a shell; browsers and CEF hosts are not.
  const web = read.filter((r) => WRAPPER_STACKS.includes(r.stack));
  const engines = read.filter((r) => r.engineBytes > 0);
  const engineBytes = engines.reduce((a, r) => a + r.engineBytes, 0);
  const intel = read.filter((r) => r.archs.length && !r.archs.includes("arm64"));
  const open = read.filter((r) => !r.sandboxed);
  const total = read.reduce((a, r) => a + r.sizeBytes, 0);

  const groups = new Map<Stack, QuickReport[]>();
  for (const r of read) groups.set(r.stack, [...(groups.get(r.stack) ?? []), r]);
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <article className="overview">
      <header className="ov-head">
        <p className="ov-progress" aria-live="polite">
          {done ? `${mine.length} apps read` : `Reading ${read.length} of ${mine.length} apps`}
          {!done && <span className="ov-progress-bar"><span style={{ width: `${(read.length / Math.max(1, mine.length)) * 100}%` }} /></span>}
        </p>
        <h1 className="ov-headline">
          {read.length === 0
            ? "Looking inside every app you've installed."
            : `${web.length} of your ${read.length} apps are web pages in a wrapper.`}
        </h1>
        {engines.length > 0 && (
          <p className="ov-sub">
            Between them they carry {engines.length} separate copies of Chromium, taking up {bytes(engineBytes)}. That's{" "}
            {Math.round((engineBytes / Math.max(1, total)) * 100)}% of everything in your Applications folder.
          </p>
        )}
        {reclaim ? (
          <p className="ov-next">
            <a href="#/cleanup">You could free up {bytes(reclaim)}</a> from caches, leftovers and apps you've stopped using.
          </p>
        ) : null}
      </header>

      {read.length > 0 && (
        <section aria-label="Apps by how they're built">
          <div className="stackbar" role="img" aria-label="Share of apps by stack">
            {ordered.map(([stack, list]) => (
              <span
                key={stack}
                style={{ flexGrow: list.length, background: STACK_COLOR[stack], boxShadow: `0 0 18px ${STACK_COLOR[stack]}55` }}
                title={`${STACK_NAME[stack]}: ${list.length}`}
              />
            ))}
          </div>

          <dl className="ov-stats">
            <div><dt>Native to the Mac</dt><dd>{read.filter((r) => ["swiftui", "swift", "objc"].includes(r.stack)).length}</dd></div>
            <div><dt>Web in a wrapper</dt><dd>{web.length}</dd></div>
            <div><dt>Still Intel-only</dt><dd>{intel.length}</dd></div>
            <div><dt>Not sandboxed</dt><dd>{open.length}</dd></div>
          </dl>

          {ordered.map(([stack, list]) => (
            <section key={stack} className="ov-group">
              <h2>
                <span className="dot" style={{ background: STACK_COLOR[stack], boxShadow: `0 0 10px ${STACK_COLOR[stack]}` }} />
                {STACK_NAME[stack]}
                <span className="muted">{list.length}</span>
              </h2>
              <ul className="tiles">
                {list.sort((a, b) => b.sizeBytes - a.sizeBytes).map((r) => (
                  <li key={r.path}>
                    <button className="tile" onClick={() => onOpen(r.path)}>
                      <img src={api.icon(r.path)} alt="" width={40} height={40} loading="lazy" />
                      <span className="tile-name">{r.name}</span>
                      <span className="tile-size">
                        {bytes(r.sizeBytes)}
                        {r.engineBytes > 0 && <span className="muted">, {Math.round((r.engineBytes / r.sizeBytes) * 100)}% Chromium</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      )}
    </article>
  );
}
