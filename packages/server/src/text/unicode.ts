/**
 * Script folding for the text filter.
 *
 * A latin-only word list is trivially bypassed: TikTok's TTS happily reads
 * Ethiopic syllabics, Hangul, kana and Cyrillic aloud, so a slur written as
 * `ኒገር`, `니거`, `ニガ` or `нигер` gets spoken while never matching an ASCII
 * blocklist. Everything here exists to produce *additional* latin views of a
 * message that the blocklist can be run against.
 *
 * Romanizations are deliberately phonetic-and-loose rather than scholarly:
 * the goal is that anything which *sounds* like a blocked word gets caught.
 */

/* ------------------------------------------------------------------ *
 * Homoglyph folding (lookalike letters -> ASCII)
 * ------------------------------------------------------------------ */

/**
 * Capitals need their own entries: Greek Ν looks like `N` while its lowercase
 * ν looks like `v`, so folding through `toLowerCase()` first gets it wrong.
 * Checked before the case-insensitive table below.
 */
const UPPERCASE_HOMOGLYPHS: Record<string, string> = {
  // Greek capitals
  Α: 'a', Β: 'b', Ε: 'e', Ζ: 'z', Η: 'h', Ι: 'i', Κ: 'k', Μ: 'm', Ν: 'n',
  Ο: 'o', Ρ: 'p', Τ: 't', Υ: 'y', Χ: 'x', Γ: 'r', Λ: 'a', Σ: 'e', Θ: 'o',
  // Cyrillic capitals
  А: 'a', В: 'b', Е: 'e', К: 'k', М: 'm', Н: 'h', О: 'o', Р: 'p', С: 'c',
  Т: 't', У: 'y', Х: 'x', І: 'i', Ј: 'j', Ѕ: 's', Ԁ: 'd', Һ: 'h', Ԝ: 'w',
};

const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic letters that render identically to latin ones
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't',
  у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', ԛ: 'q', ԝ: 'w', ѵ: 'v',
  // Greek
  α: 'a', β: 'b', ε: 'e', ζ: 'z', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p',
  τ: 't', υ: 'u', χ: 'x', γ: 'y', σ: 'o', μ: 'u', π: 'n', θ: 'o', φ: 'o',
  // Cherokee — a favourite for lookalike spoofing
  Ꭰ: 'd', Ꭱ: 'r', Ꭲ: 't', Ꭴ: 'o', Ꭵ: 'i', Ꮃ: 'w', Ꮅ: 'l', Ꮇ: 'm', Ꮈ: 'l',
  Ꮋ: 'h', Ꮍ: 'y', Ꮐ: 'g', Ꮒ: 'h', Ꮓ: 'z', Ꮖ: 'p', Ꮗ: 'e', Ꮙ: 'v', Ꮛ: 'e',
  Ꮢ: 'r', Ꮤ: 't', Ꮥ: 'd', Ꮧ: 'a', Ꮨ: 'j', Ꮪ: 'd', Ꮮ: 'c', Ꮯ: 'c', Ꮲ: 'p',
  Ꮳ: 'c', Ꮶ: 'k', Ꮷ: 'd', Ꮻ: 'w', Ꮽ: 'm', Ꮿ: 'y',
  // Armenian / Georgian lookalikes
  օ: 'o', ո: 'n', ս: 'u', ր: 'r', ց: 'g', ա: 'w', գ: 'q', զ: 'q', ք: 'p',
  // Misc symbol substitutions people type by hand
  ɑ: 'a', ƅ: 'b', ϲ: 'c', ҽ: 'e', ϝ: 'f', ɡ: 'g', հ: 'h', ɩ: 'i',
  ʝ: 'j', ⅼ: 'l', ѡ: 'w', ʐ: 'z', ʂ: 's', ƚ: 'l', ɾ: 'r',
  '𝐚': 'a', '𝟎': '0', 'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e',
  'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm',
  'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ʀ': 'r', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v',
  'ᴡ': 'w', 'ʏ': 'y', 'ᴢ': 'z',
};

/**
 * Mathematical alphanumerics (𝐚 𝓪 𝕒 𝔞 …), enclosed letters and fullwidth
 * forms all live in predictable ranges. Rather than table them out, fold them
 * arithmetically back onto ASCII.
 */
function foldDecorativeLatin(cp: number): string | null {
  // Fullwidth A-Z / a-z / 0-9
  if (cp >= 0xff21 && cp <= 0xff3a) return String.fromCharCode(cp - 0xff21 + 0x61);
  if (cp >= 0xff41 && cp <= 0xff5a) return String.fromCharCode(cp - 0xff41 + 0x61);
  if (cp >= 0xff10 && cp <= 0xff19) return String.fromCharCode(cp - 0xff10 + 0x30);

  // Circled and parenthesized latin
  if (cp >= 0x24b6 && cp <= 0x24cf) return String.fromCharCode(cp - 0x24b6 + 0x61);
  if (cp >= 0x24d0 && cp <= 0x24e9) return String.fromCharCode(cp - 0x24d0 + 0x61);
  if (cp >= 0x1f130 && cp <= 0x1f149) return String.fromCharCode(cp - 0x1f130 + 0x61);
  if (cp >= 0x1f150 && cp <= 0x1f169) return String.fromCharCode(cp - 0x1f150 + 0x61);
  if (cp >= 0x1f170 && cp <= 0x1f189) return String.fromCharCode(cp - 0x1f170 + 0x61);

  // Mathematical alphanumeric symbols: 13 styled alphabets of 52 letters each,
  // laid out as A-Z then a-z, starting at U+1D400.
  if (cp >= 0x1d400 && cp <= 0x1d7ff) {
    const offset = (cp - 0x1d400) % 52;
    if (offset < 26) return String.fromCharCode(0x61 + offset);
    return String.fromCharCode(0x61 + offset - 26);
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Ethiopic (Geʽez) syllabary
 * ------------------------------------------------------------------ */

/**
 * U+1200..U+135A is a grid: eight code points per consonant row, one per
 * vowel order. Row index gives the consonant, column gives the vowel.
 */
const ETHIOPIC_CONSONANTS = [
  'h', 'l', 'h', 'm', 's', 'r', 's', 'sh', // 1200 1208 1210 1218 1220 1228 1230 1238
  'q', 'q', 'q', 'q', 'b', 'v', 't', 'ch', // 1240 1248 1250 1258 1260 1268 1270 1278
  'h', 'h', 'n', 'ny', '', 'k', 'k', 'k',  // 1280 1288 1290 1298 12A0 12A8 12B0 12B8
  'k', 'w', '', 'z', 'zh', 'y', 'd', 'd',  // 12C0 12C8 12D0 12D8 12E0 12E8 12F0 12F8
  'j', 'g', 'g', 'ng', 't', 'ch', 'p', 'ts', // 1300 1308 1310 1318 1320 1328 1330 1338
  'ts', 'f', 'p', 'ry',                     // 1340 1348 1350 1358
];

const ETHIOPIC_VOWELS = ['e', 'u', 'i', 'a', 'e', '', 'o', 'wa'];

function romanizeEthiopicChar(cp: number): string | null {
  if (cp < 0x1200 || cp > 0x135a) return null;
  const index = cp - 0x1200;
  const consonant = ETHIOPIC_CONSONANTS[index >> 3];
  const vowel = ETHIOPIC_VOWELS[index & 7];
  if (consonant === undefined || vowel === undefined) return null;
  return consonant + vowel;
}

/* ------------------------------------------------------------------ *
 * Hangul
 * ------------------------------------------------------------------ */

const HANGUL_INITIALS = [
  'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's',
  'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
];

const HANGUL_MEDIALS = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa',
  'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i',
];

const HANGUL_FINALS = [
  '', 'g', 'kk', 'gs', 'n', 'nj', 'nh', 'd', 'l', 'lg',
  'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's',
  'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h',
];

/** Standalone compatibility jamo (ㄱ ㄴ ㅏ …), typed on their own to spell out words. */
const COMPAT_JAMO: Record<string, string> = {
  ㄱ: 'g', ㄲ: 'kk', ㄴ: 'n', ㄷ: 'd', ㄸ: 'tt', ㄹ: 'r', ㅁ: 'm', ㅂ: 'b',
  ㅃ: 'pp', ㅅ: 's', ㅆ: 'ss', ㅇ: 'ng', ㅈ: 'j', ㅉ: 'jj', ㅊ: 'ch', ㅋ: 'k',
  ㅌ: 't', ㅍ: 'p', ㅎ: 'h', ㅏ: 'a', ㅐ: 'ae', ㅑ: 'ya', ㅒ: 'yae', ㅓ: 'eo',
  ㅔ: 'e', ㅕ: 'yeo', ㅖ: 'ye', ㅗ: 'o', ㅘ: 'wa', ㅙ: 'wae', ㅚ: 'oe', ㅛ: 'yo',
  ㅜ: 'u', ㅝ: 'wo', ㅞ: 'we', ㅟ: 'wi', ㅠ: 'yu', ㅡ: 'eu', ㅢ: 'ui', ㅣ: 'i',
};

function romanizeHangulChar(cp: number): string | null {
  if (cp < 0xac00 || cp > 0xd7a3) return null;
  const index = cp - 0xac00;
  const initial = HANGUL_INITIALS[Math.floor(index / 588)];
  const medial = HANGUL_MEDIALS[Math.floor((index % 588) / 28)];
  const final = HANGUL_FINALS[index % 28];
  return `${initial ?? ''}${medial ?? ''}${final ?? ''}`;
}

/* ------------------------------------------------------------------ *
 * Kana
 * ------------------------------------------------------------------ */

const KANA: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa', ゔ: 'vu',
};

/** Digraphs like キャ (ki + ya -> kya) collapse the leading vowel. */
const YOUON: Record<string, string> = { ya: 'ya', yu: 'yu', yo: 'yo' };

function romanizeKana(text: string): string {
  let out = '';
  let geminate = false;

  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    // Katakana sits exactly 0x60 above the matching hiragana.
    const hira =
      cp >= 0x30a1 && cp <= 0x30f6 ? String.fromCodePoint(cp - 0x60) : char;

    if (hira === 'っ' || hira === 'ッ') {
      geminate = true;
      continue;
    }
    if (char === 'ー') {
      // Long-vowel mark: repeat the previous vowel.
      const last = out.at(-1);
      if (last && 'aiueo'.includes(last)) out += last;
      continue;
    }

    const romaji = KANA[hira];
    if (romaji === undefined) {
      out += char;
      geminate = false;
      continue;
    }

    const small = YOUON[romaji];
    if (small && out.length > 0 && /[aiueo]$/.test(out)) {
      out = out.slice(0, -1) + small;
    } else {
      out += geminate ? romaji.charAt(0) + romaji : romaji;
    }
    geminate = false;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Cyrillic / Greek full transliteration
 * ------------------------------------------------------------------ */

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'w',
};

const GREEK: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i',
  κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's',
  ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export const SCRIPT_NAMES = [
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
] as const;

export type ScriptName = (typeof SCRIPT_NAMES)[number];

const SCRIPT_TESTS: Array<[ScriptName, RegExp]> = SCRIPT_NAMES.map((name) => [
  name,
  new RegExp(`\\p{Script=${name}}`, 'u'),
]);

/** Which of the scripts we know about appear anywhere in the text. */
export function detectScripts(text: string): ScriptName[] {
  return SCRIPT_TESTS.filter(([, regex]) => regex.test(text)).map(([name]) => name);
}

/**
 * Cherokee small letters (U+AB70..U+ABBF) map one-to-one onto the syllabary
 * block. `toLowerCase()` turns Ꮢ into ꮢ, which would otherwise miss the
 * uppercase-keyed table below, so fold them back first.
 */
function normalizeCherokee(char: string): string {
  const cp = char.codePointAt(0) ?? 0;
  if (cp >= 0xab70 && cp <= 0xabbf) return String.fromCodePoint(cp - 0xab70 + 0x13a0);
  return char;
}

/** Folds lookalike characters onto plain ASCII without changing word shape. */
export function foldHomoglyphs(text: string): string {
  // NFKD splits accented characters into base + combining mark, which we drop.
  const decomposed = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';

  for (const raw of decomposed) {
    const char = normalizeCherokee(raw);
    // Try the character as written and as lowercased: the table mixes scripts
    // whose case rules disagree (Cherokee is keyed uppercase, the rest lower).
    const mapped =
      UPPERCASE_HOMOGLYPHS[char] ?? HOMOGLYPHS[char] ?? HOMOGLYPHS[char.toLowerCase()];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const decorative = foldDecorativeLatin(char.codePointAt(0) ?? 0);
    out += decorative ?? char;
  }
  return out;
}

/**
 * Romanizes every non-latin script we support, so a blocklist written in
 * plain English also catches `ኒገር`, `니거`, `ニガー` and `нигер`.
 */
export function transliterate(text: string): string {
  const kanaFolded = romanizeKana(text);
  let out = '';

  for (const char of kanaFolded) {
    const cp = char.codePointAt(0) ?? 0;

    const ethiopic = romanizeEthiopicChar(cp);
    if (ethiopic !== null) {
      out += ethiopic;
      continue;
    }

    const hangul = romanizeHangulChar(cp);
    if (hangul !== null) {
      out += hangul;
      continue;
    }

    const jamo = COMPAT_JAMO[char];
    if (jamo !== undefined) {
      out += jamo;
      continue;
    }

    const lower = char.toLowerCase();
    const cyrillic = CYRILLIC[lower];
    if (cyrillic !== undefined) {
      out += cyrillic;
      continue;
    }

    const greek = GREEK[lower];
    if (greek !== undefined) {
      out += greek;
      continue;
    }

    out += char;
  }

  return out;
}

/**
 * Detects words built from more than one writing system.
 *
 * This is the general form of the homoglyph problem: no glyph table will ever
 * be complete, but `ᏣΟᏒΝ` (Cherokee + Greek spelling "corn") gives itself away
 * structurally — real words don't switch scripts mid-token. Digits, spaces and
 * punctuation are script-neutral and ignored.
 *
 * Latin+Han, Latin+Hiragana and Latin+Katakana are excluded: Japanese text
 * genuinely mixes those with latin, so flagging it would punish real viewers.
 */
const NEUTRAL_SCRIPTS = new Set(['Common', 'Inherited', 'Unknown']);

const COMPATIBLE_MIXES: Array<Set<string>> = [
  new Set(['Latin', 'Han']),
  new Set(['Latin', 'Hiragana']),
  new Set(['Latin', 'Katakana']),
  new Set(['Han', 'Hiragana', 'Katakana']),
  new Set(['Latin', 'Han', 'Hiragana', 'Katakana']),
];

function scriptOf(char: string): string {
  for (const [name, regex] of SCRIPT_TESTS) {
    if (regex.test(char)) return name;
  }
  return NEUTRAL_SCRIPTS.has('Common') && /[\p{N}\p{P}\p{Z}\p{S}]/u.test(char) ? 'Common' : 'Unknown';
}

export function findMixedScriptWords(text: string): string[] {
  const flagged: string[] = [];

  for (const word of text.split(/[\s\p{P}]+/u).filter(Boolean)) {
    const scripts = new Set<string>();
    for (const char of word) {
      if (!/\p{L}/u.test(char)) continue;
      const script = scriptOf(char);
      if (!NEUTRAL_SCRIPTS.has(script)) scripts.add(script);
    }

    if (scripts.size < 2) continue;
    const compatible = COMPATIBLE_MIXES.some(
      (allowed) => [...scripts].every((script) => allowed.has(script)),
    );
    if (!compatible) flagged.push(word);
  }

  return flagged;
}

/**
 * Every latin view of a message worth running the blocklist against.
 * Always includes the original; duplicates are removed.
 */
export function matchVariants(text: string, original: string = text): string[] {
  // Canonical form first: everything below is cheaper and more accurate once
  // invisible separators and compatibility characters are gone.
  const clean = canonicalize(text);
  const variants = new Set<string>([text, clean]);
  const folded = foldHomoglyphs(clean);
  variants.add(folded);
  variants.add(transliterate(clean));
  variants.add(transliterate(folded));
  variants.add(transliterate(folded).replace(/[\s\-_.]/g, ''));
  // A right-to-left override displays the string backwards, so the reader
  // sees a word the raw text never contains. Check what they actually read.
  if (hasBidiControls(original)) {
    variants.add([...clean].reverse().join(''));
    variants.add([...folded].reverse().join(''));
  }
  // Invisible tag characters carry a payload the canonical form has already
  // thrown away, so decode them from the text as it arrived.
  if (/[󠀠-󠁾]/u.test(original)) {
    const decoded = canonicalize(decodeTagChars(original));
    variants.add(decoded);
    variants.add(foldHomoglyphs(decoded));
  }
  return [...variants].filter((v) => v.length > 0);
}

/* ------------------------------------------------------------------ *
 * Invisible characters and canonical form
 * ------------------------------------------------------------------ */

/**
 * Characters that occupy no visual space but break a word apart for any
 * matcher working on raw text.
 *
 * `n<ZWSP>i<ZWSP>g<ZWSP>g<ZWSP>e<ZWSP>r` renders identically to the slur and
 * sailed straight through the blocklist. Soft hyphen, word joiner and the tag
 * block did the same. The bidi controls are here for a different reason: they
 * reorder what the reader sees without changing the underlying string, so
 * `<RLO>reggin` displays as the slur spelled forwards.
 */
const INVISIBLE_CHARS =
  /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]|[\u{FE00}-\u{FE0F}]|[\u{E0000}-\u{E007F}]|[\u{E0100}-\u{E01EF}]/gu;

/** True when the text carries a right-to-left override or isolate. */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/u;

export const hasBidiControls = (text: string): boolean => BIDI_CONTROLS.test(text);

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE_CHARS, '');
}

/**
 * The form everything downstream should reason about.
 *
 * NFKC is the important half: it expands compatibility characters, so `㌕`
 * becomes `キログラム` and `ｎｉｇｇｅｒ` becomes plain ASCII. Doing this *before*
 * the length cap is what stops an expansion bomb — 94 characters of squared
 * katakana became 332 at synthesis time, sailing past a 200-character limit
 * that only ever saw the compressed form.
 */
export function canonicalize(text: string): string {
  return stripInvisible(text).normalize('NFKC');
}

/**
 * Letters belonging to no allowed script, as a sample of offending characters.
 *
 * `detectScripts` can only report scripts it has names for, which made
 * `blockDisallowedScripts` an allowlist implemented as a denylist: Tifinagh
 * (and roughly 130 other scripts) matched no known name, so the gate never
 * fired and `ⵏⵉⴳⵔ` reached TTS unfiltered. This asks the opposite question —
 * is this letter in something I permit? — so an unknown script fails closed.
 */
export function lettersOutsideScripts(text: string, allowed: readonly string[]): string[] {
  const tests = allowed
    .filter((name) => (SCRIPT_NAMES as readonly string[]).includes(name))
    .map((name) => new RegExp(`\\p{Script=${name}}`, 'u'));

  const offenders = new Set<string>();
  for (const char of text) {
    if (!/\p{L}/u.test(char)) continue;
    // Marks and script-neutral letters ride along with whatever they attach to.
    if (/[\p{Script=Common}\p{Script=Inherited}]/u.test(char)) continue;
    if (tests.some((test) => test.test(char))) continue;
    offenders.add(char);
    if (offenders.size >= 8) break;
  }
  return [...offenders];
}

/**
 * Decodes Unicode tag characters back into the ASCII they stand for.
 *
 * U+E0020..U+E007E mirror printable ASCII exactly 0xE0000 higher, render as
 * nothing at all, and survive copy-paste. Stripping them hides the payload;
 * decoding them puts it in front of the matcher, which is what we want.
 */
export function decodeTagChars(text: string): string {
  let out = '';
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp >= 0xe0020 && cp <= 0xe007e) out += String.fromCharCode(cp - 0xe0000);
    else out += char;
  }
  return out;
}
