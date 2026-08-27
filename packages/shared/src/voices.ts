/**
 * TikTok TTS voice catalogue.
 *
 * These are `text_speaker` codes for TikTok's internal
 * `/media/api/text/speech/invoke/` endpoint. There is no API that enumerates
 * them, and the community lists floating around disagree with each other and
 * with reality — so this list was produced empirically: every candidate code
 * was synthesized against the live endpoint and only the ones that returned
 * audio are here.
 *
 * Verified 2026-08-16 from a US account against
 * `api16-normal-useast5.us.tiktokv.com`. 83 of 96 candidates worked.
 *
 * Codes that were probed and REJECTED (don't re-add them without re-probing):
 *   br_001, en_female_f08_birthday, en_female_lady, en_male_ad_spokesman,
 *   en_male_dracula, en_male_hero, en_male_narration_v2, en_male_petergriffin,
 *   en_male_readingnice, en_male_ukguy, en_male_werewolf, jp_female_fujicochan,
 *   pt_male_bueno
 *
 * Availability varies by account and region. To re-verify against your own:
 *   npm run probe:voices -w @streaming/server
 */

export interface TtsVoice {
  code: string;
  name: string;
  group: TtsVoiceGroup;
}

export type TtsVoiceGroup =
  | 'English'
  | 'English (UK & AU)'
  | 'Character'
  | 'Seasonal'
  | 'Singing'
  | 'Español'
  | 'Français'
  | 'Deutsch'
  | 'Português'
  | 'Bahasa'
  | '日本語'
  | '한국어'
  | 'Tiếng Việt';

export const TTS_VOICES: TtsVoice[] = [
  // --- English (US) -------------------------------------------------------
  { code: 'en_us_002', name: 'Jessie', group: 'English' },
  { code: 'en_us_006', name: 'Joey', group: 'English' },
  { code: 'en_us_001', name: 'Female', group: 'English' },
  { code: 'en_us_007', name: 'Professor', group: 'English' },
  { code: 'en_us_009', name: 'Scientist', group: 'English' },
  { code: 'en_us_010', name: 'Confidence', group: 'English' },
  { code: 'en_male_narration', name: 'Story Teller', group: 'English' },
  { code: 'en_male_funny', name: 'Wacky', group: 'English' },
  { code: 'en_female_emotional', name: 'Peaceful', group: 'English' },
  { code: 'en_male_cody', name: 'Serious', group: 'English' },
  { code: 'en_female_samc', name: 'Empathetic', group: 'English' },
  { code: 'en_male_jarvis', name: 'Alfred', group: 'English' },
  { code: 'en_female_betty', name: 'Bae', group: 'English' },

  // --- English (UK & AU) --------------------------------------------------
  { code: 'en_uk_001', name: 'Narrator (UK)', group: 'English (UK & AU)' },
  { code: 'en_uk_003', name: 'Male (UK)', group: 'English (UK & AU)' },
  { code: 'en_male_ukbutler', name: 'Butler', group: 'English (UK & AU)' },
  { code: 'en_male_ukneighbor', name: 'Lord Cringe', group: 'English (UK & AU)' },
  { code: 'en_au_001', name: 'Metro (AU)', group: 'English (UK & AU)' },
  { code: 'en_au_002', name: 'Smooth (AU)', group: 'English (UK & AU)' },

  // --- Character ----------------------------------------------------------
  { code: 'en_us_ghostface', name: 'Ghostface', group: 'Character' },
  { code: 'en_us_chewbacca', name: 'Chewbacca', group: 'Character' },
  { code: 'en_us_c3po', name: 'C-3PO', group: 'Character' },
  { code: 'en_us_stitch', name: 'Stitch', group: 'Character' },
  { code: 'en_us_stormtrooper', name: 'Stormtrooper', group: 'Character' },
  { code: 'en_us_rocket', name: 'Rocket', group: 'Character' },
  { code: 'en_male_deadpool', name: 'Mr. GoodGuy', group: 'Character' },
  { code: 'en_male_jomboy', name: 'Game On', group: 'Character' },
  { code: 'en_male_trevor', name: 'Marty', group: 'Character' },
  { code: 'en_male_grinch', name: 'Trickster', group: 'Character' },
  { code: 'en_male_wizard', name: 'Magician', group: 'Character' },
  { code: 'en_male_pirate', name: 'Pirate', group: 'Character' },
  { code: 'en_female_shenna', name: 'Debutante', group: 'Character' },
  { code: 'en_female_richgirl', name: 'Bestie', group: 'Character' },
  { code: 'en_female_makeup', name: 'Beauty Guru', group: 'Character' },
  { code: 'en_female_grandma', name: 'Grandma', group: 'Character' },
  { code: 'en_male_ashmagic', name: 'AshMagic', group: 'Character' },
  { code: 'en_male_olantekkers', name: 'OlanTekkers', group: 'Character' },
  { code: 'en_female_pansino', name: 'Alan Chikin Chow', group: 'Character' },

  // --- Seasonal -----------------------------------------------------------
  { code: 'en_male_santa', name: 'Santa', group: 'Seasonal' },
  { code: 'en_male_santa_narration', name: 'Santa (narration)', group: 'Seasonal' },
  { code: 'en_male_santa_effect', name: 'Santa (with effect)', group: 'Seasonal' },
  { code: 'en_male_cupid', name: 'Cupid', group: 'Seasonal' },
  { code: 'en_male_ghosthost', name: 'Ghost Host', group: 'Seasonal' },
  { code: 'en_female_madam_leota', name: 'Madame Leota', group: 'Seasonal' },
  { code: 'en_female_ghost', name: 'Ghost', group: 'Seasonal' },

  // --- Singing ------------------------------------------------------------
  { code: 'en_female_f08_salut_damour', name: 'Alto', group: 'Singing' },
  { code: 'en_male_m03_lobby', name: 'Tenor', group: 'Singing' },
  { code: 'en_female_f08_warmy_breeze', name: 'Warmy Breeze', group: 'Singing' },
  { code: 'en_male_m03_sunshine_soon', name: 'Sunshine Soon', group: 'Singing' },
  { code: 'en_female_ht_f08_glorious', name: 'Glorious', group: 'Singing' },
  { code: 'en_female_ht_f08_wonderful_world', name: 'Dramatic', group: 'Singing' },
  { code: 'en_female_ht_f08_halloween', name: 'Opera (spooky)', group: 'Singing' },
  { code: 'en_male_sing_funny_it_goes_up', name: 'It Goes Up', group: 'Singing' },
  { code: 'en_male_m2_xhxs_m03_silly', name: 'Chipmunk', group: 'Singing' },
  { code: 'en_male_m03_classical', name: 'Classical', group: 'Singing' },
  { code: 'en_female_f08_twinkle', name: 'Twinkle', group: 'Singing' },
  { code: 'en_male_sing_deep_jingle', name: 'Cozy', group: 'Singing' },
  { code: 'en_male_sing_funny_thanksgiving', name: 'Thanksgiving', group: 'Singing' },

  // --- Other languages ----------------------------------------------------
  { code: 'es_002', name: 'Español (ES)', group: 'Español' },
  { code: 'es_mx_002', name: 'Español (MX)', group: 'Español' },
  { code: 'es_male_m3', name: 'Español masculino', group: 'Español' },
  { code: 'es_female_f6', name: 'Español femenino', group: 'Español' },
  { code: 'fr_001', name: 'Français 1', group: 'Français' },
  { code: 'fr_002', name: 'Français 2', group: 'Français' },
  { code: 'de_001', name: 'Deutsch weiblich', group: 'Deutsch' },
  { code: 'de_002', name: 'Deutsch männlich', group: 'Deutsch' },
  { code: 'br_003', name: 'Português 3', group: 'Português' },
  { code: 'br_004', name: 'Português 4', group: 'Português' },
  { code: 'br_005', name: 'Português masculino', group: 'Português' },
  { code: 'pt_female_lhays', name: 'Lhays Macedo', group: 'Português' },
  { code: 'id_001', name: 'Bahasa Indonesia', group: 'Bahasa' },
  { code: 'id_male_darma', name: 'Darma', group: 'Bahasa' },
  { code: 'id_female_noor', name: 'Noor', group: 'Bahasa' },
  { code: 'jp_001', name: '日本語 1', group: '日本語' },
  { code: 'jp_003', name: '日本語 3', group: '日本語' },
  { code: 'jp_005', name: '日本語 5', group: '日本語' },
  { code: 'jp_006', name: '日本語 男性', group: '日本語' },
  { code: 'jp_male_matsuo', name: '松尾', group: '日本語' },
  { code: 'kr_002', name: '한국어 남성', group: '한국어' },
  { code: 'kr_003', name: '한국어 여성', group: '한국어' },
  { code: 'kr_004', name: '한국어 남성 2', group: '한국어' },
  { code: 'BV074_streaming', name: 'Tiếng Việt nữ', group: 'Tiếng Việt' },
  { code: 'BV075_streaming', name: 'Tiếng Việt nam', group: 'Tiếng Việt' },
];

export const DEFAULT_TTS_VOICE = 'en_us_002';

export const TTS_VOICE_CODES: string[] = TTS_VOICES.map((v) => v.code);

/** Just the English voices — the ones a US stream will normally reach for. */
export const ENGLISH_VOICE_CODES: string[] = TTS_VOICES.filter((v) =>
  ['English', 'English (UK & AU)', 'Character', 'Seasonal', 'Singing'].includes(v.group),
).map((v) => v.code);

export function isKnownVoice(code: string): boolean {
  return TTS_VOICES.some((v) => v.code === code);
}

export function voiceLabel(code: string): string {
  return TTS_VOICES.find((v) => v.code === code)?.name ?? code;
}
