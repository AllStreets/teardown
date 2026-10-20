import { hierarchy, partition, type HierarchyRectangularNode } from "d3-hierarchy";
import { arc as d3arc } from "d3-shape";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BundleNode, NodeKind } from "../../../shared/types";
import { KIND_COLOR, KIND_LABEL, bytes, pct } from "../format";

type Node = HierarchyRectangularNode<BundleNode>;

const SIZE = 520;
const R = SIZE / 2 - 8;
const HOLE = 78;
const RINGS = 5;
const TAU = Math.PI * 2;

interface View {
  x0: number;
  x1: number;
  depth: number;
}

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Specimen({ tree, total, fileCount }: { tree: BundleNode; total: number; fileCount: number }) {
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
  const arcs = useMemo(() => {
    const span = view.x1 - view.x0 || 1;
    const limit = reveal * TAU;
    const gen = d3arc<{ a0: number; a1: number; r0: number; r1: number }>()
      .startAngle((d) => d.a0)
      .endAngle((d) => d.a1)
      .innerRadius((d) => d.r0)
      .outerRadius((d) => d.r1)
      .padAngle(0.004)
      .padRadius(R)
      .cornerRadius(2);
    const out: { node: Node; d: string; key: string }[] = [];
    for (const n of root.descendants()) {
      const rel = n.depth - view.depth;
      if (rel <= 0.001 || rel > RINGS + 0.999) continue;
      const a0 = Math.max(0, Math.min(1, (n.x0 - view.x0) / span)) * TAU;
      const a1 = Math.max(0, Math.min(1, (n.x1 - view.x0) / span)) * TAU;
      const end = Math.min(a1, limit);
      if (end - a0 < 0.002) continue;
      const r0 = HOLE + (rel - 1) * ring + 1;
      const r1 = Math.min(R, HOLE + rel * ring - 1);
      out.push({ node: n, key: ancestry(n), d: gen({ a0, a1: end, r0, r1 })! });
    }
    return out;
  }, [root, view, reveal, ring]);

  const lit = useMemo(() => {
    if (!hover) return null;
    const s = new Set<Node>(hover.ancestors());
    return s;
  }, [hover]);

  const shown = hover ?? focus;
  const crumbs = focus.ancestors().reverse();
  const kinds = useMemo(() => kindTotals(tree), [tree]);
  const sweepAngle = reveal * 360;

  return (
    <div className="specimen">
      <nav className="crumbs" aria-label="Location in bundle">
        {crumbs.map((c, i) => (
          <button key={ancestry(c)} className="crumb" disabled={i === crumbs.length - 1} onClick={() => setFocus(c)}>
            {c.data.name}
          </button>
        ))}
      </nav>

      <div className="specimen-plate">
        <svg viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`} role="img" aria-label="Map of everything inside the app bundle, sized by bytes">
          <defs>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
            <radialGradient id="lightbox">
              <stop offset="0%" stopColor="#173049" stopOpacity="0.9" />
              <stop offset="70%" stopColor="#0D1B2A" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#07111C" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#7FD3FF" stopOpacity="0" />
              <stop offset="100%" stopColor="#E6F1FF" stopOpacity="0.9" />
            </linearGradient>
          </defs>

          <circle r={R + 6} fill="url(#lightbox)" />
          {[1, 2, 3, 4, 5].map((i) => (
            <circle key={i} r={HOLE + i * ring} className="graticule" />
          ))}

          <g filter="url(#glow)" opacity="0.55" aria-hidden>
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

          {reveal < 1 && (
            <g transform={`rotate(${sweepAngle - 90})`} aria-hidden>
              <line x1={HOLE - 6} x2={R + 4} y1={0} y2={0} stroke="url(#sweep)" strokeWidth="2" />
            </g>
          )}

          <g className="hub" onClick={() => focus.parent && setFocus(focus.parent)} style={{ cursor: focus.parent ? "zoom-out" : "default" }}>
            <circle r={HOLE - 6} className="hub-disc" />
            <text y={-14} className="hub-size">{bytes(shown.value ?? 0)}</text>
            <text y={10} className="hub-name">{truncate(shown.data.name, 18)}</text>
            <text y={30} className="hub-pct">{shown === root ? `${fileCount.toLocaleString()} files` : `${pct(shown.value ?? 0, total)} of app`}</text>
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
