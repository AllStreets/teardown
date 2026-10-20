// Teardown's drawing language outside the specimen: measured strips and edge print.
import type { ReactNode } from "react";

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
  note?: string;
}

const W = 1000;

// A bar on a percent scale, with leader-line labels for the parts big enough to name.
export function MeasuredStrip({ segments, labelled = 4, unit }: { segments: Segment[]; labelled?: number; unit: (v: number) => string }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const gap = 3;
  let x = 0;
  const placed = segments.map((s) => {
    const w = (s.value / total) * W;
    const seg = { ...s, x, w };
    x += w;
    return seg;
  });
  const named = [...placed].sort((a, b) => b.value - a.value).slice(0, labelled).filter((s) => s.w > 40);
  // Stagger labels on two rows so neighbours never collide.
  const rows = named.sort((a, b) => a.x - b.x).map((s, i) => ({ ...s, row: i % 2 }));

  return (
    <svg className="strip" viewBox={`0 0 ${W} 150`} role="img" aria-label={segments.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join(", ")}>
      {rows.map((s) => {
        const cx = s.x + s.w / 2;
        const ly = s.row ? 44 : 14;
        const anchor = cx < 90 ? "start" : cx > W - 90 ? "end" : "middle";
        return (
          <g key={s.key} className="strip-callout">
            <line x1={cx} x2={cx} y1={ly + 22} y2={80} className="leader" />
            <circle cx={cx} cy={80} r={2.5} className="callout-dot" />
            <text x={cx} y={ly} textAnchor={anchor} className="callout-name">{s.label}</text>
            <text x={cx} y={ly + 15} textAnchor={anchor} className="callout-size">{unit(s.value)}  {Math.round((s.value / total) * 100)}%</text>
          </g>
        );
      })}
      {placed.map((s) => (
        <rect key={s.key} x={s.x + (s.x ? gap / 2 : 0)} y={84} width={Math.max(1, s.w - gap)} height={14} rx={3} fill={s.color} style={{ filter: `drop-shadow(0 0 8px ${s.color}55)` }}>
          <title>{`${s.label}: ${unit(s.value)}`}</title>
        </rect>
      ))}
      <g className="scale">
        {Array.from({ length: 41 }, (_, i) => {
          const tx = (i / 40) * W;
          const long = i % 10 === 0;
          return <line key={i} x1={tx} x2={tx} y1={106} y2={long ? 118 : 111} className={long ? "tick long" : "tick"} />;
        })}
        {[0, 25, 50, 75, 100].map((p) => (
          <text key={p} x={(p / 100) * W} y={136} textAnchor={p === 0 ? "start" : p === 100 ? "end" : "middle"} className="tick-label">{p}%</text>
        ))}
      </g>
    </svg>
  );
}

// The thin line of codes over each page title, like the margin print on a radiograph.
export function EdgePrint({ items }: { items: (string | number | false | null | undefined)[] }) {
  return <p className="edge-line" aria-hidden>{items.filter(Boolean).join("     ")}</p>;
}

// Numbers, sizes and stack names in a headline read as measurements.
export function Measured({ text }: { text?: string | ReactNode }) {
  if (typeof text !== "string") return <>{text}</>;
  const parts = text.split(/(\b(?:Electron|Chromium|SwiftUI|Swift|AppKit|Qt|Flutter|Java|\.NET|Python|WebKit|Rust|Go|Mac Catalyst)\b(?: \d[\d.]*)?|\b\d[\d.,]*(?: MB| GB| KB)?\b)/g);
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="measure">{p}</span> : p))}</>;
}
