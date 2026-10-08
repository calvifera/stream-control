import { useState } from 'react';
import {
  WORDLIST_PACKS,
  countMissing,
  mergeTerms,
  packSize,
  removeTerms,
  type AppConfig,
  type WordlistPack,
} from '@streaming/shared';
import { api, type FilterTestResult } from '../lib/api.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import { Blocklist } from './Blocklist.js';
import { ReviewPanel } from './ReviewPanel.js';
import { Button, Field, Panel, Row, Select, TextInput, Toggle } from './controls.js';
import { Page, SubTabs, useSubTab } from './layout.js';

interface Props {
  config: AppConfig;
  patch: (patch: Record<string, unknown>) => void;
}

const SCRIPTS = [
  'Latin',
  'Cyrillic',
  'Greek',
  'Ethiopic',
  'Hangul',
  'Han',
  'Hiragana',
  'Katakana',
  'Arabic',
  'Hebrew',
  'Devanagari',
  'Thai',
  'Cherokee',
  'Armenian',
  'Georgian',
  'Bengali',
  'Tamil',
  'Myanmar',
  'Khmer',
  'Lao',
  'Tibetan',
];

const SUBS = ['lists', 'matching', 'scripts', 'review', 'test'] as const;

export function FiltersTab({ config, patch }: Props): JSX.Element {
  const [sub, setSub] = useSubTab('filters', 'lists', SUBS);
  const filters = config.filters;
  const setFilters = (next: Partial<AppConfig['filters']>): void => patch({ filters: next });

  const [testText, setTestText] = usePersistentState('filters.testText', '');
  const [testResult, setTestResult] = useState<FilterTestResult | null>(null);

  const runTest = async (): Promise<void> => {
    if (!testText.trim()) return;
    setTestResult(await api.testFilter(testText));
  };

  const entries =
    filters.blockedWords.length +
    filters.blockedPhrases.length +
    filters.blockedRegex.length +
    filters.blockedUsers.length;

  return (
    <Page
      title="Filters"
      lead="Everything a comment passes through before it is spoken or shown. Blocked users are dropped entirely: no TTS, no overlay, no stats."
      actions={
        <Toggle label="Filter on" checked={filters.enabled} onChange={(enabled) => setFilters({ enabled })} />
      }
    >
      <SubTabs
        label="Filter sections"
        value={sub}
        onChange={setSub}
        tabs={[
          { id: 'lists', label: 'Blocklist', note: entries || null },
          { id: 'matching', label: 'Matching' },
          { id: 'scripts', label: 'Writing systems' },
          { id: 'review', label: 'Sound-alikes' },
          { id: 'test', label: 'Test a message' },
        ]}
      />

      {sub === 'lists' ? (
        <>
          <Blocklist filters={filters} onChange={setFilters} />

          <Panel
            title="Starter lists"
            description="Curated slur lists you can add to the blocked words. They are ordinary entries once added: edit or delete any of them, and adding a pack never touches terms you wrote yourself."
          >
            {WORDLIST_PACKS.map((pack) => (
              <PackRow
                key={pack.id}
                pack={pack}
                words={filters.blockedWords}
                phrases={filters.blockedPhrases}
                onApply={(blockedWords, blockedPhrases) => setFilters({ blockedWords, blockedPhrases })}
              />
            ))}
          </Panel>
        </>
      ) : null}

      {sub === 'matching' ? (
        <Panel
          title="How a match is handled"
          description="What happens when something is caught, and how hard the filter tries to see through disguises."
        >
          <Row>
            <Field label="When something matches" hint="Censor swaps just the match; skip drops the whole message">
              <Select
                value={filters.action}
                onChange={(action) => setFilters({ action })}
                options={[
                  { value: 'skip', label: 'Skip the whole message' },
                  { value: 'censor', label: 'Censor the match' },
                ]}
              />
            </Field>
            <Field label="Censor replacement">
              <TextInput
                value={filters.censorReplacement}
                onChange={(censorReplacement) => setFilters({ censorReplacement })}
              />
            </Field>
            <Field label="Max length" hint="Longer messages are truncated">
              <TextInput
                type="number"
                value={String(filters.maxLength)}
                onChange={(value) => setFilters({ maxLength: Number(value) || 200 })}
              />
            </Field>
          </Row>

          <h3>Disguises it sees through</h3>
          <div className="toggle-grid">
            <Toggle
              label="Fold leetspeak"
              hint="Catches f4ke, f@ke, f-a-k-e"
              checked={filters.normalizeLeetspeak}
              onChange={(normalizeLeetspeak) => setFilters({ normalizeLeetspeak })}
            />
            <Toggle
              label="Collapse repeated letters"
              hint="Catches faaaake"
              checked={filters.collapseRepeatedChars}
              onChange={(collapseRepeatedChars) => setFilters({ collapseRepeatedChars })}
            />
          </div>

          <h3>Clean-up before speaking</h3>
          <div className="toggle-grid">
            <Toggle
              label="Strip links"
              checked={filters.stripUrls}
              onChange={(stripUrls) => setFilters({ stripUrls })}
            />
            <Toggle
              label="Strip emoji"
              checked={filters.stripEmoji}
              onChange={(stripEmoji) => setFilters({ stripEmoji })}
            />
          </div>

          <h3>Where it applies</h3>
          <Toggle
            label="Apply to chat overlays too"
            hint="Off means overlays show the raw message and only TTS is filtered"
            checked={filters.applyToOverlay}
            onChange={(applyToOverlay) => setFilters({ applyToOverlay })}
          />
        </Panel>
      ) : null}

      {sub === 'scripts' ? (
        <Panel
          title="Writing-system bypasses"
          description="TTS reads other writing systems phonetically, so a slur typed in Ethiopic, Hangul, kana or Cyrillic gets spoken aloud while never matching a latin word list. These settings close that hole."
        >
          <Toggle
            label="Match romanized copies of every message"
            hint="ገበታ, 바보, バカ and дурак are all checked against your latin word list. A hit found only after romanizing always drops the message — it can't be censored in place."
            checked={filters.matchTransliterations}
            onChange={(matchTransliterations) => setFilters({ matchTransliterations })}
          />

          <Toggle
            label="Drop words that mix two writing systems"
            hint="ᏣΟᏒΝ spells “corn” from Cherokee and Greek letters. Words like that are spoofs by construction. Left off, they still count as evasion for strikes — this just also drops the message."
            checked={filters.blockMixedScriptWords}
            onChange={(blockMixedScriptWords) => setFilters({ blockMixedScriptWords })}
          />

          <Toggle
            label="Refuse scripts that aren't on the allowlist"
            hint="The backstop for writing systems that can't be romanized at all. Turn this on if you get targeted; leave it off if your audience writes in many languages."
            checked={filters.blockDisallowedScripts}
            onChange={(blockDisallowedScripts) => setFilters({ blockDisallowedScripts })}
          />

          {filters.blockDisallowedScripts ? (
            <Field label="Allowed scripts">
              <div className="chips">
                {SCRIPTS.map((script) => {
                  const active = filters.allowedScripts.includes(script);
                  return (
                    <button
                      key={script}
                      type="button"
                      className={active ? 'chip chip-on' : 'chip'}
                      onClick={() =>
                        setFilters({
                          allowedScripts: active
                            ? filters.allowedScripts.filter((s) => s !== script)
                            : [...filters.allowedScripts, script],
                        })
                      }
                    >
                      {script}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : null}
        </Panel>
      ) : null}

      {sub === 'review' ? (
        <>
          <Panel title="Collecting" description="Whether sound-alikes are collected into the list below at all.">
            <Toggle
              label="Collect sound-alikes"
              hint="Reports “deal dough”-style bypasses below. Never blocks on its own."
              checked={filters.reviewNearMatches}
              onChange={(reviewNearMatches) => setFilters({ reviewNearMatches })}
            />
          </Panel>
          <ReviewPanel />
        </>
      ) : null}

      {sub === 'test' ? (
        <Panel
          title="Test a message"
          description="Runs the exact chain a real comment goes through, including every romanized view."
        >
          <Row>
            <Field label="Message">
              <TextInput value={testText} onChange={setTestText} placeholder="Type or paste a comment" />
            </Field>
            <Field label=" ">
              <Button variant="primary" onClick={() => void runTest()}>
                Test
              </Button>
            </Field>
          </Row>

          {testResult ? (
            <div className="test-result">
              <div className={testResult.result.text === null ? 'banner banner-error' : 'banner banner-ok'}>
                {testResult.result.text === null
                  ? `Dropped — ${testResult.result.reason ?? 'blocked'}`
                  : `TTS would say: “${testResult.result.text}”`}
              </div>

              {testResult.result.severity === 'severe' ? (
                <div className="banner banner-error">
                  Severe-list hit
                  {testResult.result.evasion
                    ? ' via a disguised spelling — this would record a strike against the sender.'
                    : ' typed plainly. With “only count disguised attempts” on, this records no strike.'}
                </div>
              ) : null}

              {testResult.mixedScriptWords.length > 0 ? (
                <div className="banner banner-error">
                  Mixed-script word{testResult.mixedScriptWords.length > 1 ? 's' : ''}:{' '}
                  <code>{testResult.mixedScriptWords.join(', ')}</code> — letters from two writing
                  systems inside one word, which is a spoof by construction.
                </div>
              ) : null}

              {testResult.matches.length > 0 ? (
                <Field label="Matched">
                  <ul className="plain-list">
                    {testResult.matches.map((match) => (
                      <li key={match} className="mono">
                        {match}
                      </li>
                    ))}
                  </ul>
                </Field>
              ) : null}

              <Row>
                <Field label="Scripts detected">
                  <div className="chips">
                    {testResult.scripts.length === 0 ? (
                      <span className="muted">none</span>
                    ) : (
                      testResult.scripts.map((script) => (
                        <span key={script} className="chip chip-static chip-action">
                          {script}
                        </span>
                      ))
                    )}
                  </div>
                </Field>
                <Field label="Romanized views checked">
                  <ul className="plain-list">
                    {testResult.variants.map((variant, index) => (
                      <li key={`${variant}-${index}`} className="mono">
                        {variant}
                      </li>
                    ))}
                  </ul>
                </Field>
              </Row>
            </div>
          ) : null}
        </Panel>
      ) : null}
    </Page>
  );
}

/**
 * One starter pack: what it covers, how much of it is already in your list,
 * and the full contents on request.
 *
 * The terms are shown rather than hidden behind a count on purpose — this is a
 * list that decides which of your viewers get silenced, so you should be able
 * to read it before you turn it on.
 */
function PackRow({
  pack,
  words,
  phrases,
  onApply,
}: {
  pack: WordlistPack;
  words: string[];
  phrases: string[];
  onApply: (blockedWords: string[], blockedPhrases: string[]) => void;
}): JSX.Element {
  const [shown, setShown] = useState(false);
  const missing = countMissing(words, pack.words) + countMissing(phrases, pack.phrases);
  const applied = missing === 0;

  return (
    <div className={pack.risky ? 'pack-row pack-row-risky' : 'pack-row'}>
      <div className="pack-head">
        <div>
          <strong>{pack.label}</strong>{' '}
          <span className="muted">
            {applied ? `all ${packSize(pack)} added` : `${missing} of ${packSize(pack)} not added`}
          </span>
          <p className="muted pack-blurb">{pack.description}</p>
        </div>
        <div className="button-row nowrap">
          <Button onClick={() => setShown(!shown)}>{shown ? 'Hide terms' : 'Show terms'}</Button>
          {applied ? (
            <Button
              variant="danger"
              onClick={() =>
                onApply(removeTerms(words, pack.words), removeTerms(phrases, pack.phrases))
              }
            >
              Remove
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() =>
                onApply(mergeTerms(words, pack.words), mergeTerms(phrases, pack.phrases))
              }
            >
              Add {missing}
            </Button>
          )}
        </div>
      </div>

      {shown ? (
        <div className="chips">
          {[...pack.phrases, ...pack.words].map((term) => (
            <span key={term} className="chip chip-static mono">
              {term}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
