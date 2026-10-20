// The small set of controls every Teardown page is built from.
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger" | "quiet";

export function Button({
  variant = "ghost", icon: Icon, children, busy, ...rest
}: { variant?: Variant; icon?: LucideIcon; busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`btn btn-${variant}${rest.className ? " " + rest.className : ""}`} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {Icon && <Icon size={15} aria-hidden className={busy ? "spin" : undefined} />}
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)}>
      <span className="toggle-knob" />
    </button>
  );
}

export function Select<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <select className="select" aria-label={label} value={String(value)} onChange={(e) => {
      const hit = options.find((o) => String(o.value) === e.target.value);
      if (hit) onChange(hit.value);
    }}>
      {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
}

export function Checkbox({ checked, onChange, label, indeterminate }: { checked: boolean; onChange: (v: boolean) => void; label: string; indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" className="checkbox" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

export function PageHeader({ title, lede, actions, edge }: { title: string; lede?: ReactNode; actions?: ReactNode; edge?: (string | number | false | null | undefined)[] }) {
  return (
    <header className="page-head">
      <div>
        {edge && <p className="edge-line" aria-hidden>{edge.filter(Boolean).join("     ")}</p>}
        <h1 className="page-title">{title}</h1>
        {lede && <p className="page-lede">{lede}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, children, id }: { title: string; description?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="panel" id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className="panel-head">
        <h2 className="panel-title" id={id ? `${id}-title` : undefined}>{title}</h2>
        {description && <p className="panel-desc">{description}</p>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function SettingRow({ label, description, children }: { label: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <p className="setting-label">{label}</p>
        {description && <p className="setting-desc">{description}</p>}
      </div>
      {children && <div className="setting-control">{children}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <Icon size={22} aria-hidden />
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Dialog({ open, title, children, onClose, actions }: { open: boolean; title: string; children: ReactNode; onClose: () => void; actions: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={id} onClose={onClose} onCancel={onClose}>
      <h2 id={id} className="dialog-title">{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">{actions}</div>
    </dialog>
  );
}

export function Meter({ value, max }: { value: number; max: number }) {
  return (
    <span className="meter" aria-hidden>
      <span style={{ width: `${Math.max(2, Math.min(100, (value / Math.max(1, max)) * 100))}%` }} />
    </span>
  );
}
