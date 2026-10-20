import { hierarchy, partition, type HierarchyRectangularNode } from "d3-hierarchy";
import { arc as d3arc } from "d3-shape";
import { useEffect, useMemo, useState } from "react";
import type { BundleNode } from "../../../shared/types";
import { KIND_COLOR, bytes } from "../format";

type Node = HierarchyRectangularNode<BundleNode>;

const W = 900;
const H = 560;
const R = 220;
const HOLE = 62;
const RINGS = 5;
const TAU = Math.PI * 2;
const ring = (R - HOLE) / RINGS;

const layout = (tree: BundleNode) =>
  partition<BundleNode>().size([TAU, 1])(
    hierarchy(tree, (d) => d.children).sum((d) => (d.children?.length ? 0 : Math.max(d.size, 0))).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
  );

// Paths ignore the app's own folder name, so a renamed bundle still lines up.
const key = (n: Node) => n.ancestors().reverse().slice(1).map((a) => a.data.name).join("/");

const gen = d3arc<{ a0: number; a1: number; r0: number; r1: number }>()
  .startAngle((d) => d.a0).endAngle((d) => d.a1).innerRadius((d) => d.r0).outerRadius((d) => d.r1)
  .padAngle(0.004).padRadius(R).cornerRadius(2);

const geo = (n: Node) => ({ a0: n.x0, a1: n.x1, r0: HOLE + (n.depth - 1) * ring + 1, r1: HOLE + n.depth * ring - 1 });
const visible = (n: Node) => n.depth >= 1 && n.depth <= RINGS && n.x1 - n.x0 > 0.002;

export function DiffPlate({ before, after, label }: { before?: BundleNode; after: BundleNode; label: string }) {
  const [reveal, setReveal] = useState(0);
  const old = useMemo(() => (before ? layout(before) : undefined), [before]);
  const cur = useMemo(() => layout(after), [after]);
  const oldKeys = useMemo(() => new Set(old?.descendants().map(key) ?? []), [old]);

  // A part is new when the previous version had nothing at that path.
  const fresh = useMemo(() => {
    if (!old) return new Set<Node>();
    const s = new Set<Node>();
    for (const n of cur.descendants()) if (n.depth >= 1 && !oldKeys.has(key(n)) && !(n.parent && s.has(n.parent))) s.add(n);
    return s;
  }, [cur, old, oldKeys]);
  const isFresh = (n: Node) => n.ancestors().some((a) => fresh.has(a));

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setReveal(1);
    setReveal(0);
    let raf = 0;
    const start = performance.now() + 250;
    const tick = (t: number) => {
      const k = Math.max(0, Math.min(1, (t - start) / 1600));
      setReveal(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const done = setTimeout(() => setReveal(1), 2200);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [after]);

  const limit = reveal * TAU;
  const callouts = useMemo(() => {
    const list = [...fresh].filter(visible).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 4);
    const placed = list.map((n) => {
      const mid = (n.x0 + n.x1) / 2;
      const g = geo(n);
      return {
        n, side: Math.sin(mid) >= 0 ? 1 : -1,
        ax: Math.sin(mid) * g.r1, ay: -Math.cos(mid) * g.r1,
        ex: Math.sin(mid) * (R + 6), ey: -Math.cos(mid) * (R + 6),
        y: Math.max(-H / 2 + 40, Math.min(H / 2 - 40, -Math.cos(mid) * (R + 40))),
      };
    });
    for (const side of [1, -1]) {
      const s = placed.filter((c) => c.side === side).sort((a, b) => a.y - b.y);
      for (let i = 1; i < s.length; i++) s[i].y = Math.max(s[i].y, s[i - 1].y + 54);
    }
    return placed;
  }, [fresh]);

  return (
    <div className="lightbox diff-plate">
      <svg viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} role="img" aria-label="The new version drawn over an outline of the previous one, with new parts labelled">
        <defs>
          <radialGradient id="diff-light">
            <stop offset="0%" stopColor="#1b3a57" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#07111C" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle r={R + 60} fill="url(#diff-light)" />
        <g className="scale" aria-hidden>
          {Array.from({ length: 100 }, (_, i) => {
            const a = (i / 100) * TAU, long = i % 25 === 0;
            return <line key={i} x1={Math.sin(a) * (R + 9)} y1={-Math.cos(a) * (R + 9)} x2={Math.sin(a) * (R + (long ? 22 : 14))} y2={-Math.cos(a) * (R + (long ? 22 : 14))} className={long ? "tick long" : "tick"} />;
          })}
        </g>

        {old && (
          <g className="ghost" aria-hidden>
            {old.descendants().filter(visible).map((n) => <path key={key(n)} d={gen(geo(n))!} />)}
          </g>
        )}

        <g>
          {cur.descendants().filter(visible).map((n) => {
            const g = geo(n);
            const end = Math.min(g.a1, limit);
            if (end - g.a0 < 0.002) return null;
            const isNew = isFresh(n);
            return (
              <path key={key(n)} d={gen({ ...g, a1: end })!} fill={isNew ? "#FFB547" : KIND_COLOR[n.data.kind]}
                fillOpacity={isNew ? 0.95 : 0.55} className={isNew ? "new-part" : undefined}>
                <title>{`${n.data.name}\n${bytes(n.value ?? 0)}${isNew ? "\nNew in this version" : ""}`}</title>
              </path>
            );
          })}
        </g>

        {reveal >= 1 && callouts.map((c) => {
          const x = c.side * (R + 70);
          const anchor = c.side > 0 ? "start" : "end";
          return (
            <g key={key(c.n)} className="callout diff-callout">
              <polyline points={`${c.ax},${c.ay} ${c.ex},${c.ey} ${c.side * (R + 50)},${c.y} ${x - c.side * 8},${c.y}`} className="leader" />
              <circle cx={c.ax} cy={c.ay} r={3.5} className="callout-dot" />
              <text x={x} y={c.y - 22} textAnchor={anchor} className="diff-tag">NEW</text>
              <text x={x} y={c.y - 4} textAnchor={anchor} className="callout-name">{c.n.data.name.split("/")[0]}</text>
              <text x={x} y={c.y + 14} textAnchor={anchor} className="callout-size">{bytes(c.n.value ?? 0)}</text>
            </g>
          );
        })}

        <g className="hub">
          <circle r={HOLE - 6} className="hub-disc" />
          <text y={6} className="hub-size">{label}</text>
        </g>
      </svg>
      {!old && <p className="diff-note">There's no earlier snapshot with a size map to compare against, so only the new version is drawn.</p>}
    </div>
  );
}
