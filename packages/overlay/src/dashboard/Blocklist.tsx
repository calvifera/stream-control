import { useMemo, useState } from 'react';
import type { AppConfig } from '@streaming/shared';
import { Button, Field, Panel, Select } from './controls.js';
import { Icon } from './icons.js';
import { Disclosure } from './layout.js';

type Filters = AppConfig['filters'];
type Kind = 'word' | 'phrase' | 'pattern' | 'user';

const KINDS: Array<{
  id: Kind;
  field: 'blockedWords' | 'blockedPhrases' | 'blockedRegex' | 'blockedUsers';
  label: string;
  plural: string;
  hint: string;
  placeholder: string;
}> = [
  {
    id: 'word',
    field: 'blockedWords',
    label: 'Word',
    plural: 'Words',
    hint: 'Whole-word match: “ass” will not hit “classy”.',
    placeholder: 'badword',
  },
  {
    id: 'phrase',
    field: 'blockedPhrases',
    label: 'Phrase',
    plural: 'Phrases',
    hint: 'Matched anywhere, and can span words.',
    placeholder: 'follow me back',
  },
  {
    id: 'pattern',
    field: 'blockedRegex',
    label: 'Pattern',
    plural: 'Patterns',
    hint: 'A regular expression, not case-sensitive.',
    placeholder: 'discord\\.gg/\\S+',
  },
  {
    id: 'user',
    field: 'blockedUsers',
    label: 'User',
    plural: 'Users',
    hint: 'A bare handle blocks it on every platform; write tiktok:name or twitch:name to block one person.',
    placeholder: 'spambot123',
  },
];

const PAGE = 50;

/**
 * Everything the filter drops, as one table.
 *
 * The four lists are stored separately because they are matched differently,
 * but they are one idea to the person using them: things that get blocked. So
 * they are added the same way, searched together and removed the same way, with
 * the kind shown as a column.
 */
export function Blocklist({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (next: Partial<Filters>) => void;
}): JSX.Element {
  const [kind, setKind] = useState<Kind>('word');
  const [entry, setEntry] = useState('');
  const [bulk, setBulk] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Kind | 'all'>('all');
  const [limit, setLimit] = useState(PAGE);

  const meta = KINDS.find((candidate) => candidate.id === kind) ?? (KINDS[0] as (typeof KINDS)[number]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return KINDS.flatMap((candidate) =>
      // Newest first within a kind, since additions append.
      filters[candidate.field]
        .map((value, index) => ({ kind: candidate, value, index }))
        .reverse(),
    )
      .filter((row) => (show === 'all' ? true : row.kind.id === show))
      .filter((row) => (needle ? row.value.toLowerCase().includes(needle) : true));
  }, [filters, search, show]);

  const total = KINDS.reduce((sum, candidate) => sum + filters[candidate.field].length, 0);

  /** Adds each line to the chosen kind, skipping blanks, repeats and bad patterns. */
  const add = (raw: string): void => {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const existing = new Set(filters[meta.field].map((value) => value.toLowerCase()));
    const fresh: string[] = [];
    const invalid: string[] = [];
    for (const line of lines) {
      if (existing.has(line.toLowerCase())) continue;
      if (kind === 'pattern') {
        try {
          new RegExp(line, 'i');
        } catch {
          invalid.push(line);
          continue;
        }
      }
      existing.add(line.toLowerCase());
      fresh.push(line);
    }

    if (fresh.length > 0) {
      onChange({ [meta.field]: [...filters[meta.field], ...fresh] } as Partial<Filters>);
    }
    const skipped = lines.length - fresh.length - invalid.length;
    const parts = [
      fresh.length > 0 ? `Added ${fresh.length} ${fresh.length === 1 ? meta.label.toLowerCase() : meta.plural.toLowerCase()}.` : '',
      skipped > 0 ? `${skipped} already on the list.` : '',
      invalid.length > 0 ? `Not a valid pattern: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '…' : ''}.` : '',
    ].filter(Boolean);
    setMessage({ tone: invalid.length > 0 && fresh.length === 0 ? 'error' : 'ok', text: parts.join(' ') });
    setEntry('');
    setBulk('');
    setShow('all');
    setSearch('');
  };

  const remove = (field: (typeof KINDS)[number]['field'], index: number): void => {
    onChange({ [field]: filters[field].filter((_, position) => position !== index) } as Partial<Filters>);
  };

  const shown = rows.slice(0, limit);

  return (
    <>
      <Panel
        title="Add to the blocklist"
        description="Anything on the blocklist is censored or dropped before it is spoken or shown. Changes save immediately."
      >
        <form
          className="blocklist-add"
          onSubmit={(event) => {
            event.preventDefault();
            add(entry);
          }}
        >
          <Field label="Type">
            <Select
              value={kind}
              onChange={(next) => {
                setKind(next);
                setMessage(null);
              }}
              options={KINDS.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
            />
          </Field>
          <Field label={meta.label} hint={meta.hint}>
            <input
              className={kind === 'pattern' ? 'input mono' : 'input'}
              type="text"
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
              placeholder={meta.placeholder}
            />
          </Field>
          <div className="blocklist-add-button">
            <Button variant="primary" onClick={() => add(entry)} disabled={!entry.trim()}>
              Add
            </Button>
          </div>
        </form>

        {message ? <div className={message.tone === 'error' ? 'banner banner-error' : 'banner'}>{message.text}</div> : null}

        <Disclosure summary="Paste many at once">
          <Field label={`${meta.plural}, one per line`} hint={`Added as ${meta.plural.toLowerCase()}. Repeats are skipped.`}>
            <textarea
              className="input mono"
              rows={5}
              value={bulk}
              onChange={(event) => setBulk(event.target.value)}
              placeholder={meta.placeholder}
            />
          </Field>
          <Button onClick={() => add(bulk)} disabled={!bulk.trim()}>
            Add all
          </Button>
        </Disclosure>
      </Panel>

      <Panel title="Blocklist" description={`${total} ${total === 1 ? 'entry' : 'entries'} in total.`}>
        <div className="blocklist-toolbar">
          <input
            className="input"
            type="search"
            value={search}
            placeholder="Search the blocklist"
            aria-label="Search the blocklist"
            onChange={(event) => {
              setSearch(event.target.value);
              setLimit(PAGE);
            }}
          />
          <div className="chips" role="group" aria-label="Show">
            <button type="button" className={show === 'all' ? 'chip chip-on' : 'chip'} onClick={() => { setShow('all'); setLimit(PAGE); }}>
              All {total}
            </button>
            {KINDS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={show === candidate.id ? 'chip chip-on' : 'chip'}
                onClick={() => {
                  setShow(candidate.id);
                  setLimit(PAGE);
                }}
              >
                {candidate.plural} {filters[candidate.field].length}
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="muted">{total === 0 ? 'Nothing is blocked yet.' : 'No entry matches.'}</p>
        ) : (
          <div className="table-wrap">
            <table className="table blocklist-table">
              <thead>
                <tr>
                  <th scope="col">Entry</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="blocklist-col-x">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={`${row.kind.id}:${row.index}:${row.value}`}>
                    <td className="blocklist-entry mono">{row.value}</td>
                    <td>{row.kind.label}</td>
                    <td className="blocklist-col-x">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remove ${row.value}`}
                        onClick={() => remove(row.kind.field, row.index)}
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > shown.length ? (
          <div className="blocklist-more">
            <Button onClick={() => setLimit(limit + PAGE * 4)}>Show {Math.min(PAGE * 4, rows.length - shown.length)} more</Button>
            <span className="muted">
              Showing {shown.length} of {rows.length}
            </span>
          </div>
        ) : null}
      </Panel>
    </>
  );
}
