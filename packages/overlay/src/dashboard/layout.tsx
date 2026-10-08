import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { usePersistentState } from '../lib/usePersistentState.js';

/**
 * Page frame: a title, one line saying what the page is for, and the page's
 * own actions. Every dashboard area opens with this, so the place you are is
 * never a guess.
 */
export function Page({
  title,
  lead,
  actions,
  children,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>{title}</h1>
          {lead ? <p className="page-lead">{lead}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export interface SubTab<T extends string> {
  id: T;
  label: string;
  /** A short state or count shown after the label. */
  note?: string | number | null;
  /** Draws a small mark on the tab when something there needs attention. */
  attention?: boolean;
}

/**
 * In-page tabs. They split a long area into screens instead of one scroll,
 * and remember which one you were on per browser.
 */
export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Array<SubTab<T>>;
  value: T;
  onChange: (next: T) => void;
  label: string;
}): JSX.Element {
  const list = useRef<HTMLDivElement | null>(null);
  const base = useId();

  // Arrow keys move between tabs and select, the way a tablist is expected to.
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const ids = tabs.map((tab) => tab.id);
    const at = ids.indexOf(value);
    let next = at;
    if (event.key === 'ArrowRight') next = (at + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (at - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    else return;
    event.preventDefault();
    const id = ids[next];
    if (id === undefined) return;
    onChange(id);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus();
  };

  return (
    <div className="subtabs" role="tablist" aria-label={label} ref={list} onKeyDown={onKey}>
      {tabs.map((tab) => {
        const on = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${base}-${tab.id}`}
            data-tab={tab.id}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={on ? 'subtab subtab-on' : 'subtab'}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {tab.note !== undefined && tab.note !== null && tab.note !== '' ? (
              <span className="subtab-note">{tab.note}</span>
            ) : null}
            {tab.attention ? (
              <span className="subtab-attention" role="img" aria-label="needs attention" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Which in-page tab is open, remembered per area. */
export function useSubTab<T extends string>(area: string, first: T, all: readonly T[]): [T, (next: T) => void] {
  return usePersistentState<T>(`sub.${area}`, first, (stored) => all.includes(stored));
}

/**
 * Secondary material folded behind one line. Native `<details>`, so it works
 * from the keyboard and survives a re-render without extra state.
 */
export function Disclosure({
  summary,
  children,
  open,
}: {
  summary: string;
  children: ReactNode;
  open?: boolean;
}): JSX.Element {
  return (
    <details className="disclose" open={open}>
      <summary>{summary}</summary>
      <div className="disclose-body">{children}</div>
    </details>
  );
}
