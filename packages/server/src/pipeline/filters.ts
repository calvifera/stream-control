import type { FilterConfig, Platform, SevereTermsConfig } from '@streaming/shared';
import { normalizeHandle, parseViewerKey, viewerKey } from '@streaming/shared';
import { createLogger } from '../logger.js';
import {
  canonicalize,
  capCombiningMarks,
  detectScripts,
  findMixedScriptWords,
  lettersOutsideScripts,
  matchVariants,
} from '../text/unicode.js';

const EMPTY_SEVERE: SevereTermsConfig = { words: [], phrases: [], regex: [] };

const log = createLogger('filters');

export interface FilterResult {
  /** Cleaned text, or null when the message should be dropped entirely. */
  text: string | null;
  /** True when anything was censored, dropped or stripped. */
  filtered: boolean;
  /** Short human explanation, shown in the dashboard event log. */
  reason: string | null;
  /**
   * `normal` is an ordinary blocklist hit. `severe` means it matched the
   * zero-tolerance list, which is what auto-penalties are built on.
   */
  severity: 'none' | 'normal' | 'severe';
  /**
   * True when the match was only visible after romanizing, folding homoglyphs
   * or normalizing a mixed-script word — i.e. the viewer went out of their way
   * to get it past the filter rather than just typing it.
   */
  evasion: boolean;
  /**
   * Whether the original text must stay hidden from the host as well.
   *
   * Almost nothing qualifies. A filter hit is worth reading: a false positive
   * is only findable by looking at what the message actually said, and a
   * severe hit is exactly the one a host wants to see before handing out a
   * ban. Those are marked, not hidden.
   *
   * The single exception is a refused or mixed script, which is unreadable to
   * the host by definition — that is what made it refused — so there is
   * nothing on the other side of unfolding it.
   */
  redact: boolean;
}

/**
 * Characters commonly swapped in to dodge a word list. Matching happens
 * against the *original* text using these classes rather than against a
 * normalized copy, so a censor action can splice the replacement back into
 * the message at the right offsets.
 */
const LEET_CLASSES: Record<string, string> = {
  a: 'a@4àáâãäå',
  b: 'b8ß',
  c: 'c(<¢ç',
  d: 'd',
  e: 'e3€èéêë',
  f: 'f',
  // `q` for `g` is one of the most common substitutions for exactly the terms
  // the severe list exists for ("niqqa", "faqqot"), and reads as the original
  // to TTS and to a human alike.
  g: 'g69q',
  h: 'h#',
  i: 'i1!|íìîï',
  j: 'j',
  k: 'k',
  l: 'l1|£',
  m: 'm',
  n: 'nñ',
  o: 'o0°òóôõö',
  p: 'p',
  q: 'q',
  r: 'r',
  s: 's5$§',
  t: 't7+',
  u: 'uüùúû',
  v: 'v',
  w: 'w',
  x: 'x×',
  y: 'y¥ÿ',
  z: 'z2',
};

/** Characters people wedge between letters: `f.u.c.k`, `f u c k`, `f-u-c-k`. */
const SEPARATOR = '[\\s\\-_.,*·•~^`\'"\\\\/|]{0,3}';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function charPattern(char: string, leet: boolean, collapse: boolean): string {
  const lower = char.toLowerCase();
  const cls = leet ? LEET_CLASSES[lower] : undefined;
  const body = cls ? `[${escapeRegex(cls)}]` : escapeRegex(char);
  return collapse ? `${body}+` : body;
}

/**
 * Builds a tolerant pattern for one term. `wholeWord` anchors it so `ass`
 * cannot match inside `class` — phrases skip that so they can span words.
 */
function buildTermPattern(term: string, config: FilterConfig, wholeWord: boolean): string | null {
  const trimmed = term.trim();
  if (!trimmed) return null;

  const { normalizeLeetspeak: leet, collapseRepeatedChars: collapse } = config;
  const parts: string[] = [];

  for (const char of trimmed) {
    if (/\s/.test(char)) {
      // Inside a phrase, whitespace in the term means "at least some gap".
      parts.push('\\s+');
      continue;
    }
    parts.push(charPattern(char, leet, collapse));
  }

  const body = parts.join(leet || collapse ? SEPARATOR : '');
  if (!wholeWord) return body;
  return `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`;
}

interface CompiledPattern {
  regex: RegExp;
  label: string;
  severe: boolean;
}

interface CompiledFilters {
  patterns: CompiledPattern[];
  /**
   * Blocked on one service only, keyed `platform:handle`.
   *
   * Split from `blockedAnywhere` because a bare handle is not an identity:
   * TikTok's @bob and Twitch's @bob are two unrelated people, and a single
   * flat set silently blocks both. Blocked events are dropped before the
   * directory, the overlays, the stats and TTS, so the stranger it catches
   * leaves no trace at all — there is nothing to notice and nothing to undo.
   */
  blockedOn: Set<string>;
  /**
   * Blocked on every service, by bare handle.
   *
   * Kept as a deliberate option rather than an accident: a spambot name is
   * often reused across platforms, and "block this handle wherever it turns
   * up" is a real thing to want. It just has to be asked for.
   */
  blockedAnywhere: Set<string>;
  allowedScripts: Set<string>;
}

/** Upper bound on text handed to the matcher, well above any real message. */
const SAFETY_CAP = 4000;

const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|gg|tv|co|me|xyz|link|live)\b\S*/gi;

// Emoji, pictographs, flags, variation selectors and ZWJ sequences.
const EMOJI_PATTERN =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

export class FilterEngine {
  private config: FilterConfig;
  private severe: SevereTermsConfig;
  private compiled: CompiledFilters;

  constructor(config: FilterConfig, severe: SevereTermsConfig = EMPTY_SEVERE) {
    this.config = config;
    this.severe = severe;
    this.compiled = this.compile(config, severe);
  }

  setConfig(config: FilterConfig, severe: SevereTermsConfig = this.severe): void {
    // Recompiling is cheap but not free; only redo it when something changed.
    if (
      JSON.stringify(config) === JSON.stringify(this.config) &&
      JSON.stringify(severe) === JSON.stringify(this.severe)
    ) {
      return;
    }
    this.config = config;
    this.severe = severe;
    this.compiled = this.compile(config, severe);
  }

  private compile(config: FilterConfig, severe: SevereTermsConfig): CompiledFilters {
    const patterns: CompiledPattern[] = [];

    const addWords = (words: string[], isSevere: boolean): void => {
      for (const word of words) {
        const source = buildTermPattern(word, config, true);
        if (!source) continue;
        try {
          patterns.push({
            regex: new RegExp(source, 'giu'),
            label: `${isSevere ? 'severe ' : ''}word "${word.trim()}"`,
            severe: isSevere,
          });
        } catch (error) {
          log.warn(`Skipping blocked word "${word}": ${String(error)}`);
        }
      }
    };

    const addPhrases = (phrases: string[], isSevere: boolean): void => {
      for (const phrase of phrases) {
        const source = buildTermPattern(phrase, config, false);
        if (!source) continue;
        try {
          patterns.push({
            regex: new RegExp(source, 'giu'),
            label: `${isSevere ? 'severe ' : ''}phrase "${phrase.trim()}"`,
            severe: isSevere,
          });
        } catch (error) {
          log.warn(`Skipping blocked phrase "${phrase}": ${String(error)}`);
        }
      }
    };

    const addRegex = (sources: string[], isSevere: boolean): void => {
      for (const source of sources) {
        const trimmed = source.trim();
        if (!trimmed) continue;
        try {
          patterns.push({
            regex: new RegExp(trimmed, 'gi'),
            label: `${isSevere ? 'severe ' : ''}regex /${trimmed}/`,
            severe: isSevere,
          });
        } catch (error) {
          // A half-typed regex in the dashboard shouldn't take the filter down.
          log.warn(`Skipping invalid regex "${trimmed}": ${String(error)}`);
        }
      }
    };

    // Severe patterns first so a message hitting both reports the worse one.
    addWords(severe.words, true);
    addPhrases(severe.phrases, true);
    addRegex(severe.regex, true);
    addWords(config.blockedWords, false);
    addPhrases(config.blockedPhrases, false);
    addRegex(config.blockedRegex, false);

    const blockedOn = new Set<string>();
    const blockedAnywhere = new Set<string>();
    for (const raw of config.blockedUsers) {
      const entry = raw.trim().toLowerCase().replace(/^@/, '');
      if (!entry) continue;

      const scoped = parseViewerKey(entry);
      if (scoped) {
        blockedOn.add(viewerKey(scoped.platform, scoped.handle));
        continue;
      }
      // Anything not written as `platform:handle` blocks that handle
      // everywhere. Reading a bare entry as TikTok-only would have silently
      // stopped blocking people the moment a second platform was connected,
      // and an entry that quietly stops working is the worst outcome for a
      // list whose whole job is to keep someone out.
      blockedAnywhere.add(entry.replace(/^\*:/, ''));
    }

    return {
      patterns,
      blockedOn,
      blockedAnywhere,
      allowedScripts: new Set(config.allowedScripts),
    };
  }

  /**
   * Runs every pattern over every latin view of the message.
   *
   * Returns which variant matched: a hit on the original text can be censored
   * in place, but a hit that only shows up after transliteration has no
   * meaningful offset in the original, so the message gets dropped instead.
   */
  private findMatch(
    text: string,
    original: string = text,
  ): { label: string; inOriginal: boolean; severe: boolean } | null {
    const variants = this.config.matchTransliterations ? matchVariants(text, original) : [text];

    for (const { regex, label, severe } of this.compiled.patterns) {
      for (const [index, variant] of variants.entries()) {
        regex.lastIndex = 0;
        if (regex.test(variant)) {
          return { label, inOriginal: index === 0, severe };
        }
      }
    }
    return null;
  }

  /**
   * Letters the host has not allowed through to TTS.
   *
   * Asks whether each letter is in an allowed script rather than whether it
   * belongs to a *known* disallowed one. The old form could only refuse the 21
   * scripts it had names for, so Tifinagh — and every other unnamed script —
   * was invisible to it and passed straight through.
   */
  private disallowedLetters(text: string): string[] {
    if (!this.config.blockDisallowedScripts) return [];
    return lettersOutsideScripts(text, this.config.allowedScripts);
  }

  /**
   * Whether this person is blocked.
   *
   * Takes the platform as well as the handle — without it there is no way to
   * tell the two @bobs apart, and the caller would be asking a question that
   * cannot be answered correctly.
   */
  isUserBlocked(platform: Platform, uniqueId: string): boolean {
    if (!this.config.enabled) return false;
    const handle = normalizeHandle(uniqueId);
    if (!handle) return false;
    return (
      this.compiled.blockedAnywhere.has(handle) ||
      this.compiled.blockedOn.has(viewerKey(platform, handle))
    );
  }

  /**
   * Runs the whole chain: user block -> strip -> match -> length cap.
   *
   * `speaker` is optional because plenty of callers filter text that nobody
   * said — a TTS preview, a template test. Those skip the block check rather
   * than guessing at a platform.
   */
  apply(text: string, speaker?: { platform: Platform; uniqueId: string }): FilterResult {
    const config = this.config;
    if (!config.enabled) {
      return { text, filtered: false, reason: null, severity: 'none', evasion: false, redact: false };
    }

    if (speaker && this.isUserBlocked(speaker.platform, speaker.uniqueId)) {
      return {
        text: null,
        filtered: true,
        reason: 'user is blocked',
        severity: 'none',
        evasion: false,
        // Nothing objectionable is being hidden — the person is muted, not the
        // words — so the host can still read what they said.
        redact: false,
      };
    }

    /*
     * Work on the canonical form from here on.
     *
     * This strips invisible separators (which broke words apart for the
     * matcher) and applies NFKC (which expands compatibility characters).
     * Both have to happen before the length cap: a 94-character message of
     * squared katakana expands to 332 at synthesis time, so a cap applied to
     * the raw text let an expansion bomb through untouched.
     */
    let working = canonicalize(text);

    /*
     * Trim stacked combining marks before anything measures the text.
     *
     * Canonicalization does not touch these — the marks Zalgo is built from
     * have no precomposed form, so NFKC leaves every one of them in place.
     * They survived to the overlay and to the TTS queue, where enough of them
     * overflow a chat row into the lines above it. Capping here rather than at
     * render time means the length limit below sees the real length, and every
     * surface gets the same trimmed text.
     */
    const capped = capCombiningMarks(working);
    const trimmedMarks = capped !== working;
    working = capped;

    let filtered = working !== text;
    const reasons: string[] = [];
    if (filtered) reasons.push(trimmedMarks ? 'trimmed stacked marks' : 'normalized');

    /*
     * A generous safety bound, not the user-facing cap.
     *
     * Canonicalization can multiply length several times over, and everything
     * below runs the whole pattern set across every variant, so the work has
     * to be bounded somewhere. It is deliberately far above `maxLength`:
     * truncating to the real cap this early cut a repeating payload down to
     * just under the spam threshold and hid it from the matcher. The real cap
     * applies at the end, once matching has seen the whole message.
     */
    if (working.length > SAFETY_CAP) working = working.slice(0, SAFETY_CAP);

    // A word that switches writing systems mid-token is a spoof by
    // construction — no glyph table needed to spot it.
    const mixedScriptWords = findMixedScriptWords(text);

    if (config.stripUrls) {
      const stripped = working.replace(URL_PATTERN, '');
      if (stripped !== working) {
        working = stripped;
        filtered = true;
        reasons.push('stripped link');
      }
    }

    if (config.stripEmoji) {
      const stripped = working.replace(EMOJI_PATTERN, '');
      if (stripped !== working) {
        working = stripped;
        filtered = true;
        reasons.push('stripped emoji');
      }
    }

    if (config.blockMixedScriptWords && mixedScriptWords.length > 0) {
      return {
        text: null,
        filtered: true,
        reason: `mixed-script word: ${mixedScriptWords.join(', ')}`,
        severity: 'normal',
        evasion: true,
        redact: true,
      };
    }

    const disallowed = this.disallowedLetters(working);
    if (disallowed.length > 0) {
      /*
       * Still work out the severity before returning. This gate used to
       * short-circuit with 'normal', which meant a slur written in a refused
       * script was dropped but earned no strike — disabling penalties for
       * precisely the attack the severe list exists to catch.
       */
      const match = this.findMatch(working, text);
      const scripts = detectScripts(working).join(', ') || 'unknown script';
      return {
        text: null,
        filtered: true,
        reason: match?.severe
          ? `blocked by ${match.label} (written in ${scripts})`
          : `script not allowed: ${disallowed.join(' ')} (${scripts})`,
        severity: match?.severe ? 'severe' : 'normal',
        // Folded either way. A refused script is unreadable to the host by
        // definition — that is why it was refused — so showing it buys
        // nothing and costs the one thing the block was for.
        redact: true,
        evasion: true,
      };
    }

    // Loop until clean: censoring one hit can reveal another underneath.
    for (let pass = 0; pass < 8; pass += 1) {
      const match = this.findMatch(working, text);
      if (!match) break;

      // Anything not spelled in plain latin was a deliberate dodge, whether it
      // needed romanizing, homoglyph folding, or mixed two scripts in a word.
      const evasion = !match.inOriginal || mixedScriptWords.length > 0;

      // A match visible only after transliteration cannot be spliced out of
      // the original safely, so it always costs the whole message.
      if (config.action === 'skip' || !match.inOriginal) {
        const how = match.inOriginal ? '' : ' (found via transliteration)';
        return {
          text: null,
          filtered: true,
          reason: `blocked by ${match.label}${how}`,
          severity: match.severe ? 'severe' : 'normal',
          evasion,
          redact: false,
        };
      }

      const pattern = this.compiled.patterns.find((p) => p.label === match.label);
      if (!pattern) break;
      pattern.regex.lastIndex = 0;
      const censored = working.replace(pattern.regex, config.censorReplacement);
      if (censored === working) break;
      working = censored;
      filtered = true;
      reasons.push(`censored ${match.label}`);

      // A severe term is never merely censored — it costs the whole message,
      // and the caller needs the severity to decide on a penalty.
      if (match.severe) {
        return {
          text: null,
          filtered: true,
          reason: `blocked by ${match.label}`,
          severity: 'severe',
          evasion,
          // Shown, in red. The host decides what to do about it, and that
          // decision is worse blind than informed.
          redact: false,
        };
      }
    }

    working = working.replace(/\s{2,}/g, ' ').trim();

    if (!working) {
      return {
        text: null,
        filtered: true,
        reason: reasons.join('; ') || 'empty after filtering',
        severity: 'normal',
        evasion: mixedScriptWords.length > 0,
        redact: false,
      };
    }

    // Second pass: censoring can lengthen the text past what it replaced.
    // Only reported when the earlier cap did not already fire.
    if (working.length > config.maxLength) {
      working = `${working.slice(0, config.maxLength).trimEnd()}…`;
      filtered = true;
      if (!reasons.some((r) => r.startsWith('truncated'))) {
        reasons.push(`truncated to ${config.maxLength} chars`);
      }
    }

    if (mixedScriptWords.length > 0) {
      reasons.push(`mixed-script word: ${mixedScriptWords.join(', ')}`);
    }

    return {
      text: working,
      filtered,
      reason: reasons.length ? reasons.join('; ') : null,
      severity: filtered ? 'normal' : 'none',
      evasion: mixedScriptWords.length > 0,
      redact: false,
    };
  }

  /**
   * Dashboard "test a message" helper: shows what matched, which romanized
   * view caught it, and what TTS would end up saying.
   */
  explain(text: string): {
    result: FilterResult;
    matches: string[];
    variants: string[];
    scripts: string[];
    mixedScriptWords: string[];
  } {
    const variants = this.config.matchTransliterations ? matchVariants(canonicalize(text), text) : [text];
    const matches: string[] = [];

    for (const { regex, label } of this.compiled.patterns) {
      for (const [index, variant] of variants.entries()) {
        regex.lastIndex = 0;
        if (regex.test(variant)) {
          matches.push(index === 0 ? label : `${label} (as "${variant}")`);
          break;
        }
      }
    }

    return {
      result: this.apply(text),
      matches,
      variants,
      scripts: detectScripts(text),
      mixedScriptWords: findMixedScriptWords(text),
    };
  }
}
