import { hierarchy, partition, type HierarchyRectangularNode } from "d3-hierarchy";
import { arc as d3arc } from "d3-shape";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BundleNode, NodeKind } from "../../../shared/types";
import { KIND_COLOR, KIND_LABEL, bytes, pct } from "../format";

type Node = HierarchyRectangularNode<BundleNode>;

// The plate is wider than the specimen so callouts have room on both sides.
const W = 1000;
const H = 600;
const R = 250;
const HOLE = 74;
const RINGS = 5;
const TAU = Math.PI * 2;
const LABEL_X = R + 70;

interface View {
  x0: number;
  x1: number;
  depth: number;
}

interface Callout {
  node: Node;
  side: 1 | -1;
  ax: number;
  ay: number;
  ex: number;
  ey: number;
  y: number;
}

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Specimen({ tree, total, fileCount, edge }: { tree: BundleNode; total: number; fileCount: number; edge: string[] }) {
  const root = useMemo(() => {
    const h = hierarchy(tree, (d) => d.children)
      .sum((d) => (d.children?.length ? 0 : Math.max(d.size, 0)))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return partition<BundleNode>().size([1, 1])(h);
  }, [tree]);

  const [focus, setFocus] = useState<Node>(root);
  const [hover, setHover] = useState<Node | null>(null);
  const [view, setView] = useState<View>({ x0: 0, x1: 1, depth: 0 });
  const [reveal, setReveal] = useState(reduceMotion() ? 1 : 0);
  const viewRef = useRef(view);
  viewRef.current = view;

  // Reset when a new app is loaded, and run the one scan sweep.
  useEffect(() => {
    setFocus(root);
    setHover(null);
    setView({ x0: 0, x1: 1, depth: 0 });
    if (reduceMotion()) return setReveal(1);
    setReveal(0);
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 1500);
      setReveal(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Frames pause in background tabs; never leave the specimen half drawn.
    const done = setTimeout(() => setReveal(1), 1800);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [root]);

  // Tween the view toward the focused node.
  useEffect(() => {
    const from = viewRef.current;
    const to: View = { x0: focus.x0, x1: focus.x1, depth: focus.depth };
    if (reduceMotion()) return setView(to);
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 550);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      setView({
        x0: from.x0 + (to.x0 - from.x0) * e,
        x1: from.x1 + (to.x1 - from.x1) * e,
        depth: from.depth + (to.depth - from.depth) * e,
      });
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [focus]);

  const ring = (R - HOLE) / RINGS;
  const geom = useMemo(() => {
    const span = view.x1 - view.x0 || 1;
    return (n: Node) => {
      const rel = n.depth - view.depth;
      const a0 = Math.max(0, Math.min(1, (n.x0 - view.x0) / span)) * TAU;
      const a1 = Math.max(0, Math.min(1, (n.x1 - view.x0) / span)) * TAU;
      return { rel, a0, a1, r0: HOLE + (rel - 1) * ring + 1, r1: Math.min(R, HOLE + rel * ring - 1) };
    };
  }, [view, ring]);

  const arcs = useMemo(() => {
    const limit = reveal * TAU;
    const gen = d3arc<{ a0: number; a1: number; r0: number; r1: number }>()
      .startAngle((d) => d.a0).endAngle((d) => d.a1)
      .innerRadius((d) => d.r0).outerRadius((d) => d.r1)
      .padAngle(0.004).padRadius(R).cornerRadius(2);
    const out: { node: Node; d: string; key: string }[] = [];
    for (const n of root.descendants()) {
      const g = geom(n);
      if (g.rel <= 0.001 || g.rel > RINGS + 0.999) continue;
      const end = Math.min(g.a1, limit);
      if (end - g.a0 < 0.002) continue;
      out.push({ node: n, key: ancestry(n), d: gen({ ...g, a1: end })! });
    }
    return out;
  }, [root, geom, reveal]);

  // Exploded-view callouts: the parts worth naming, with leader lines out to the margins.
  const callouts = useMemo<Callout[]>(() => {
    if (view.depth !== focus.depth) return [];
    const fv = focus.value ?? 1;
    const big = (n: Node) => (n.children ?? []).filter((c) => (c.value ?? 0) / fv >= 0.03 && !c.data.collapsed);
    // Exploded view: start from the top-level parts and keep splitting the largest one into its
    // components until about six pieces are named, never deeper than the rings drawn.
    let picked: Node[] = big(focus);
    for (let guard = 0; guard < 20; guard++) {
      const splittable = picked
        .filter((n) => n.depth - focus.depth < 4 && big(n).length > 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      const target = splittable.find((n) => picked.length - 1 + big(n).length <= 6 || big(n).length === 1);
      if (!target) break;
      picked = [...picked.filter((n) => n !== target), ...big(target)];
    }
    picked = picked.filter((n) => (n.value ?? 0) / fv >= 0.03).slice(0, 7);
    const raw = picked.map((n) => {
      const g = geom(n);
      const mid = (g.a0 + g.a1) / 2;
      const ax = Math.sin(mid) * g.r1;
      const ay = -Math.cos(mid) * g.r1;
      // Leave the specimen radially before bending, so leaders never cut across other rings.
      const ex = Math.sin(mid) * (R + 4);
      const ey = -Math.cos(mid) * (R + 4);
      return { node: n, side: (Math.sin(mid) >= 0 ? 1 : -1) as 1 | -1, ax, ay, ex, ey, y: -Math.cos(mid) * (R + 30) };
    });
    // Keep labels on each side at least 52 units apart.
    for (const side of [1, -1] as const) {
      const list = raw.filter((c) => c.side === side).sort((a, b) => a.y - b.y);
      for (let i = 1; i < list.length; i++) list[i].y = Math.max(list[i].y, list[i - 1].y + 52);
      const over = (list.at(-1)?.y ?? 0) - (H / 2 - 40);
      if (over > 0) list.forEach((c) => (c.y -= over));
      for (const c of list) c.y = Math.max(c.y, -H / 2 + 34);
    }
    return raw;
  }, [focus, geom, view.depth]);

  const lit = useMemo(() => (hover ? new Set<Node>(hover.ancestors()) : null), [hover]);
  const shown = hover ?? focus;
  const crumbs = focus.ancestors().reverse();
  const kinds = useMemo(() => kindTotals(tree), [tree]);

  return (
    <div className="specimen">
      <nav className="crumbs" aria-label="Location in bundle">
        {crumbs.map((c, i) => (
          <button key={ancestry(c)} className="crumb" disabled={i === crumbs.length - 1} onClick={() => setFocus(c)}>
            {c.data.name}
          </button>
        ))}
      </nav>

      <div className="lightbox">
        <p className="edge-print" aria-hidden>{edge.join("   ")}</p>
        <svg viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} role="img" aria-label="Map of everything inside the app bundle, sized by bytes, with the largest parts labelled">
          <defs>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
            <radialGradient id="plate-light">
              <stop offset="0%" stopColor="#1b3a57" stopOpacity="0.95" />
              <stop offset="55%" stopColor="#10243a" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#07111C" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#7FD3FF" stopOpacity="0" />
              <stop offset="100%" stopColor="#E6F1FF" stopOpacity="0.9" />
            </linearGradient>
          </defs>

          <circle r={R + 70} fill="url(#plate-light)" />

          {/* Measurement ring: the angle is share of bytes, so the scale reads in percent. */}
          <g className="scale" aria-hidden>
            {Array.from({ length: 100 }, (_, i) => {
              const a = (i / 100) * TAU;
              const long = i % 25 === 0;
              const mid = i % 5 === 0;
              const r0 = R + 9;
              const r1 = R + (long ? 22 : mid ? 16 : 13);
              return <line key={i} x1={Math.sin(a) * r0} y1={-Math.cos(a) * r0} x2={Math.sin(a) * r1} y2={-Math.cos(a) * r1} className={long ? "tick long" : "tick"} />;
            })}
            {[0, 25, 50, 75].map((p) => {
              const a = (p / 100) * TAU;
              const rr = R + 36;
              return <text key={p} x={Math.sin(a) * rr} y={-Math.cos(a) * rr + 4} className="tick-label">{p}%</text>;
            })}
          </g>

          {[1, 2, 3, 4, 5].map((i) => <circle key={i} r={HOLE + i * ring} className="graticule" />)}

          <g filter="url(#glow)" opacity="0.5" aria-hidden>
            {arcs.map(({ node, d, key }) => (
              <path key={key} d={d} fill={colorOf(node)} opacity={lit && !lit.has(node) ? 0.1 : 1} />
            ))}
          </g>
          <g>
            {arcs.map(({ node, d, key }) => (
              <path
                key={key}
                d={d}
                className="arc"
                fill={colorOf(node)}
                fillOpacity={lit ? (lit.has(node) ? 1 : 0.18) : node.children ? 0.92 : 0.8}
                onMouseEnter={() => setHover(node)}
                onMouseLeave={() => setHover(null)}
                onClick={() => node.children && setFocus(node)}
                style={{ cursor: node.children ? "zoom-in" : "default" }}
              >
                <title>{`${node.data.name}\n${bytes(node.value ?? 0)}`}</title>
              </path>
            ))}
          </g>

          {reveal >= 1 && callouts.map((c) => {
            const x = c.side * LABEL_X;
            const elbow = c.side * (R + 46);
            const active = hover === c.node;
            const anchor = c.side === 1 ? "start" : "end";
            return (
              <g key={ancestry(c.node)} className={`callout${active ? " active" : ""}`}
                onMouseEnter={() => setHover(c.node)} onMouseLeave={() => setHover(null)}
                onClick={() => c.node.children && setFocus(c.node)} style={{ cursor: c.node.children ? "zoom-in" : "default" }}>
                <circle cx={c.ax} cy={c.ay} r={3} className="callout-dot" />
                <polyline points={`${c.ax},${c.ay} ${c.ex},${c.ey} ${elbow},${c.y} ${x - c.side * 8},${c.y}`} className="leader" />
                <text x={x} y={c.y - 4} textAnchor={anchor} className="callout-name">{truncate(partName(c.node), 34)}</text>
                <text x={x} y={c.y + 14} textAnchor={anchor} className="callout-size">
                  {bytes(c.node.value ?? 0)}  {pct(c.node.value ?? 0, total)}
                </text>
              </g>
            );
          })}

          {reveal < 1 && (
            <g transform={`rotate(${reveal * 360 - 90})`} aria-hidden>
              <line x1={HOLE - 6} x2={R + 24} y1={0} y2={0} stroke="url(#sweep)" strokeWidth="2" />
            </g>
          )}

          <g className="hub" onClick={() => focus.parent && setFocus(focus.parent)} style={{ cursor: focus.parent ? "zoom-out" : "default" }}>
            <circle r={HOLE - 6} className="hub-disc" />
            <text y={-12} className="hub-size">{bytes(shown.value ?? 0)}</text>
            <text y={10} className="hub-name">{truncate(shown.data.name, 16)}</text>
            <text y={28} className="hub-pct">{shown === root ? `${fileCount.toLocaleString()} files` : `${pct(shown.value ?? 0, total)} of app`}</text>
          </g>
        </svg>
      </div>

      <ul className="legend">
        {kinds.map(([k, v]) => (
          <li key={k}>
            <span className="swatch" style={{ background: KIND_COLOR[k], boxShadow: `0 0 10px ${KIND_COLOR[k]}66` }} />
            <span>{KIND_LABEL[k]}</span>
            <span className="legend-size">{bytes(v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SHADES = [0, -0.22, 0.16, -0.36, 0.28, -0.12, 0.08];

function mix(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const target = amt >= 0 ? [230, 241, 255] : [7, 17, 28];
  const k = Math.abs(amt);
  return `rgb(${ch.map((c, i) => Math.round(c + (target[i] - c) * k)).join(",")})`;
}

// Siblings that share a kind get stepped shades so the structure stays visible.
function colorOf(n: Node) {
  const base = KIND_COLOR[n.data.kind];
  const p = n.parent;
  if (!p || p.data.kind !== n.data.kind || !p.parent) return base;
  const i = p.children!.indexOf(n);
  return mix(base, SHADES[i % SHADES.length] - Math.min(0.2, (n.depth - 1) * 0.03));
}

const GENERIC = /^(Resources|Libraries|Frameworks|Contents|MacOS|Helpers|PlugIns|Versions|A|Current|lib|bin|share)$/i;
const clean = (name: string) => name.split("/")[0].replace(/\.(framework|app|bundle|appex|xpc)$/, "");

// Folder names like Resources mean nothing alone; say whose they are.
function partName(n: Node) {
  const own = clean(n.data.name);
  if (!GENERIC.test(own)) return own;
  const owner = n.ancestors().slice(1).find((a) => !GENERIC.test(clean(a.data.name)));
  return owner ? `${clean(owner.data.name)} / ${own}` : own;
}

function ancestry(n: Node) {
  return n.ancestors().map((a) => a.data.name).join("/");
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function kindTotals(tree: BundleNode): [NodeKind, number][] {
  const m = new Map<NodeKind, number>();
  const walk = (x: BundleNode) => {
    if (!x.children) m.set(x.kind, (m.get(x.kind) ?? 0) + x.size);
    else x.children.forEach(walk);
  };
  walk(tree);
  return [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}
