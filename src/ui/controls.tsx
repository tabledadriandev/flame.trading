import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleHelp, X } from 'lucide-react';
import { parseNumber } from '../lib/format';

// The small set of controls every view is built from. One implementation
// each, so the same role looks the same everywhere.

export function Pane({
  title,
  tools,
  children,
  className,
  label,
  head,
}: {
  title?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  className?: string;
  label: string;
  /** Replaces the default header content (used by the tabbed drawer). */
  head?: ReactNode;
}) {
  return (
    <section className={className ? `pane ${className}` : 'pane'} aria-label={label}>
      <header className="pane-head">
        {head ?? (
          <>
            <h2 className="pane-title">{title}</h2>
            {tools ? <div className="pane-tools">{tools}</div> : null}
          </>
        )}
      </header>
      {children}
    </section>
  );
}

/** Loading, empty and failed states. `title` says what happened; `children` say what to do next. */
export function PaneState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="pane-state" role="status">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  block,
  tall,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  label: string;
  block?: boolean;
  tall?: boolean;
}) {
  const cls = ['seg', block ? 'seg-block' : '', tall ? 'seg-tall' : ''].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const live = options.filter((o) => !o.disabled);
        const i = live.findIndex((o) => o.value === value);
        const next = live[(i + (e.key === 'ArrowRight' ? 1 : live.length - 1)) % live.length];
        if (next) {
          e.preventDefault();
          onChange(next.value);
          const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
          buttons[live.indexOf(next)]?.focus();
        }
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          className="seg-item"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A number field that keeps what was typed and reports the parsed value. */
export function NumField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  note,
  placeholder,
  invalid,
  aside,
  action,
  id,
  inputRef,
}: {
  label: ReactNode;
  value: string;
  onChange: (text: string, n: number) => void;
  prefix?: string;
  suffix?: string;
  note?: ReactNode;
  placeholder?: string;
  invalid?: boolean;
  /** Shown at the right of the label row: a derived reading such as "2.4R". */
  aside?: ReactNode;
  /** A small button inside the box, such as "Max" or "Last". */
  action?: { label: string; onClick: () => void; title?: string };
  id?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="field" data-invalid={invalid ? 'true' : undefined}>
      <div className="field-label">
        <label htmlFor={fid}>{label}</label>
        {aside ? <small className="num">{aside}</small> : null}
      </div>
      <div className="field-box">
        {prefix ? <span className="field-affix">{prefix}</span> : null}
        <input
          id={fid}
          ref={inputRef}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value, parseNumber(e.target.value))}
        />
        {suffix ? <span className="field-affix">{suffix}</span> : null}
        {action ? (
          <button type="button" className="field-affix field-affix-btn" onClick={action.onClick} title={action.title}>
            {action.label}
          </button>
        ) : null}
      </div>
      {note ? <div className="field-note">{note}</div> : null}
    </div>
  );
}

/** A plain one-line explanation, one hover, focus or tap away. */
export function Help({ children, label = 'What this means', align }: { children: ReactNode; label?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    setUp(r ? r.bottom > window.innerHeight - 140 : false);
    setOpen(true);
  };
  return (
    <span className="help" ref={ref} onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="help-btn"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else show();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        <CircleHelp size={13} aria-hidden="true" />
      </button>
      {open ? (
        <span className="help-pop" role="tooltip" id={id} data-align={align} data-up={up ? 'true' : undefined}>
          {children}
        </span>
      ) : null}
    </span>
  );
}

export interface TabDef<T extends string> {
  id: T;
  label: string;
  count?: number;
  strong?: boolean;
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: TabDef<T>[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div
      className="tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const i = tabs.findIndex((t) => t.id === value);
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        if (next) {
          onChange(next.id);
          e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[tabs.indexOf(next)]?.focus();
        }
      }}
    >
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" className="tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count ? (
            <span className="count" data-strong={t.strong ? 'true' : undefined}>
              {t.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** Buying or selling, said three ways: a glyph, a word and a hue. */
export function SideTag({ side, children }: { side: 'buy' | 'sell'; children: ReactNode }) {
  return (
    <span className={`side ${side === 'buy' ? 'hot' : 'cold'}`}>
      <span className="side-glyph" aria-hidden="true">
        {side === 'buy' ? '▲' : '▼'}
      </span>
      {children}
    </span>
  );
}

export function Dialog({
  title,
  children,
  foot,
  onClose,
  wide,
}: {
  title: string;
  children: ReactNode;
  foot?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const first = box?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button:not([data-close])');
    (first ?? box)?.focus();
    return () => before?.focus?.();
  }, []);
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={ref}
        style={wide ? { width: 'min(760px, 100%)' } : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'Tab') {
            // Keep focus inside the dialog.
            const items = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href], [tabindex="0"]');
            if (!items || items.length === 0) return;
            const first = items[0]!;
            const last = items[items.length - 1]!;
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn-quiet btn-icon" data-close onClick={onClose} aria-label="Close">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {foot ? <div className="dialog-foot">{foot}</div> : null}
      </div>
    </div>
  );
}
