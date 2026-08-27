import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          {description ? <p className="muted">{description}</p> : null}
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Row({ children }: { children: ReactNode }): JSX.Element {
  return <div className="row">{children}</div>;
}

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

/**
 * Text input that keeps its own state while typing and only reports upward
 * after a pause — otherwise every keystroke would round-trip to the server
 * and the value would fight the socket broadcast coming back.
 */
export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  monospace,
  delay = 300,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  monospace?: boolean;
  delay?: number;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  // Accept external updates only when the user isn't mid-edit.
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);

  const commit = (next: string): void => {
    setDraft(next);
    dirty.current = true;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      dirty.current = false;
      onChange(next);
    }, delay);
  };

  return (
    <input
      className={monospace ? 'input mono' : 'input'}
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => commit(event.target.value)}
      onBlur={() => {
        if (timer.current) window.clearTimeout(timer.current);
        dirty.current = false;
        if (draft !== value) onChange(draft);
      }}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!dirty.current) setDraft(String(value));
  }, [value]);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const clamp = (n: number): number =>
    Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));

  /**
   * Clamping happens here and nowhere else.
   *
   * It used to clamp on every keystroke, which made the obvious gesture —
   * select all, type a new number — destructive: clearing the field parsed as
   * 0, clamped straight to the minimum and saved it, so a width of 480 became
   * 16 before the first digit was even typed.
   */
  const commit = (raw: string, settled: boolean): void => {
    const trimmed = raw.trim();
    const parsed = Number(trimmed);

    if (!settled) {
      // Mid-typing. A half-finished number is not a value yet: "4" on the way
      // to "480" is below a minimum of 16, and clamping it would overwrite
      // what is being typed. Wait for more input, or for blur to settle it.
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      if (trimmed === '' || !Number.isFinite(parsed)) return;
      if (parsed !== clamp(parsed)) return;
      dirty.current = false;
      if (parsed !== latest.current) onChange(parsed);
      return;
    }

    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    dirty.current = false;

    // An empty or unparseable field means "no change", not zero.
    if (trimmed === '' || !Number.isFinite(parsed)) {
      setDraft(String(latest.current));
      return;
    }

    const next = clamp(parsed);
    setDraft(String(next));
    if (next !== latest.current) onChange(next);
  };

  return (
    <input
      className="input"
      /*
       * Deliberately not type="number": browsers change a focused number
       * field when the wheel passes over it, so scrolling the page could
       * silently resize a source. inputMode still brings up a numeric keypad
       * on touch.
       */
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(event) => {
        const raw = event.target.value;
        // Let a partial number through — "", "-", "4." are all on the way
        // somewhere — but ignore anything that isn't heading for a number.
        if (!/^-?\d*\.?\d*$/.test(raw)) return;
        setDraft(raw);
        dirty.current = true;
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => commit(raw, false), 500);
      }}
      onBlur={(event) => commit(event.target.value, true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit(draft, true);
          return;
        }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        // Native stepping is lost with type="text", so provide it.
        event.preventDefault();
        const direction = event.key === 'ArrowUp' ? 1 : -1;
        const base = Number(draft.trim()) || latest.current;
        commit(String(base + direction * step * (event.shiftKey ? 10 : 1)), true);
      }}
    />
  );
}

/**
 * Integer field you can scrub with the scroll wheel.
 *
 * Sliders are fiddly for values you want to set precisely and repeatedly —
 * this takes a wheel over the box, arrow keys, or typing. The wheel listener
 * is registered natively rather than through React so it can be non-passive:
 * a passive listener cannot call preventDefault, and without that the page
 * scrolls away underneath you while you adjust.
 *
 * `caption` shows what the number actually means (e.g. "1.00x"), since a
 * 1-100 scale is only meaningful next to the value it maps to.
 */
export function ScrollNumber({
  value,
  onChange,
  min = 1,
  max = 100,
  caption,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  caption?: string;
}): JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(String(value));
  const dirty = useRef(false);
  // The wheel handler is bound once; it reads through this to avoid capturing
  // a stale value in its closure.
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!dirty.current) setDraft(String(value));
  }, [value]);

  const clamp = (n: number): number => Math.min(max, Math.max(min, Math.round(n)));

  const commit = useCallback(
    (next: number): void => {
      const clamped = Math.min(max, Math.max(min, Math.round(next)));
      dirty.current = false;
      setDraft(String(clamped));
      if (clamped !== latest.current) onChange(clamped);
    },
    [max, min, onChange],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      // Shift jumps by ten, matching the arrow-key behaviour below.
      commit(latest.current + direction * (event.shiftKey ? 10 : 1));
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [commit]);

  return (
    <div className="scrub">
      <input
        ref={ref}
        className="input scrub-input"
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(event) => {
          dirty.current = true;
          setDraft(event.target.value.replace(/[^0-9-]/g, ''));
        }}
        onBlur={() => commit(Number(draft) || latest.current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const direction = event.key === 'ArrowUp' ? 1 : -1;
            commit(latest.current + direction * (event.shiftKey ? 10 : 1));
          }
          if (event.key === 'Enter') commit(Number(draft) || latest.current);
        }}
      />
      <div className="scrub-meta">
        {/* Fill bar doubles as a scale reference at a glance. */}
        <span className="scrub-track" aria-hidden="true">
          <span
            className="scrub-fill"
            style={{ width: `${((clamp(value) - min) / (max - min)) * 100}%` }}
          />
        </span>
        {caption ? <span className="scrub-caption">{caption}</span> : null}
      </div>
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
  format,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (value: number) => string;
}): JSX.Element {
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="slider-value">{format ? format(value) : value.toFixed(2)}</span>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}): JSX.Element {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-text">
        {label}
        {hint ? <span className="field-hint">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; group?: string }>;
}): JSX.Element {
  const groups = new Map<string, typeof options>();
  for (const option of options) {
    const key = option.group ?? '';
    const list = groups.get(key) ?? [];
    list.push(option);
    groups.set(key, list);
  }

  return (
    <select className="input" value={value} onChange={(event) => onChange(event.target.value as T)}>
      {[...groups.entries()].map(([group, items]) =>
        group ? (
          <optgroup key={group} label={group}>
            {items.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </optgroup>
        ) : (
          items.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))
        ),
      )}
    </select>
  );
}

/** Multi-select rendered as toggle chips — friendlier than a multiple select. */
export function ChipSelect<T extends string>({
  values,
  options,
  onChange,
}: {
  values: T[];
  options: Array<{ value: T; label: string }>;
  onChange: (values: T[]) => void;
}): JSX.Element {
  return (
    <div className="chips">
      {options.map((option) => {
        const active = values.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            className={active ? 'chip chip-on' : 'chip'}
            onClick={() =>
              onChange(
                active ? values.filter((v) => v !== option.value) : [...values, option.value],
              )
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Editable list of short strings (blocked words, allowed users, gift names).
 * Stored one per line, which is the fastest thing to paste into.
 */
export function ListEditor({
  values,
  onChange,
  placeholder,
  rows = 6,
  delay = 800,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  rows?: number;
  delay?: number;
}): JSX.Element {
  const [draft, setDraft] = useState(values.join('\n'));
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!dirty.current) setDraft(values.join('\n'));
  }, [values]);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const commit = (text: string): void => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    dirty.current = false;
    onChange(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    );
  };

  return (
    <div className="list-editor">
      <textarea
        className="input mono"
        rows={rows}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          dirty.current = true;
          // Blur alone is not enough: closing the tab mid-edit used to throw
          // the list away. The pause is longer than a text field's so a line
          // isn't saved half-typed on every keystroke.
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => commit(next), delay);
        }}
        onBlur={(event) => commit(event.target.value)}
      />
      <span className="field-hint">
        One per line · {values.length} {values.length === 1 ? 'entry' : 'entries'} · saves as you
        type
      </span>
    </div>
  );
}

export function TextArea({
  value,
  onChange,
  rows = 4,
  placeholder,
  monospace,
  delay = 500,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  monospace?: boolean;
  delay?: number;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const commit = (next: string): void => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    dirty.current = false;
    if (next !== value) onChange(next);
  };

  return (
    <textarea
      className={monospace ? 'input mono' : 'input'}
      rows={rows}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        dirty.current = true;
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => commit(next), delay);
      }}
      onBlur={() => commit(draft)}
    />
  );
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`btn btn-${variant}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

/**
 * Centred dialog with its own scroll.
 *
 * Rendered through a portal into `<body>` rather than in place: panels carry
 * `backdrop-filter`, which makes each one a stacking context, so a dialog
 * rendered inside one could never sit above its siblings no matter what
 * z-index it asked for.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const surface = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // Stop the page behind from scrolling while the dialog owns the screen.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    surface.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      // mousedown, not click: releasing a drag that started inside the dialog
      // should not be read as clicking the backdrop.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div className="modal-title">
            <h2>{title}</h2>
            {subtitle ? <p className="muted">{subtitle}</p> : null}
          </div>
          <div className="panel-actions">
            {actions}
            <button type="button" className="modal-close" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
        </header>
        <div className="modal-body" ref={surface} tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function StatusDot({ status }: { status: string }): JSX.Element {
  return <span className={`dot dot-${status}`} />;
}
