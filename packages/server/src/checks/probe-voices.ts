/**
 * Probes every candidate voice code against the live endpoint to find which
 * ones your account/region can actually synthesize.
 *   npm run probe:voices -w @streaming/server
 *
 * Community voice lists disagree with each other and go stale, so this treats
 * the API as the source of truth. Failures are retried once, because a single
 * rejection under load is not proof a voice is gone.
 *
 * Never prints the session id.
 */
import fs from 'node:fs';
import { TTS_VOICE_CODES } from '@streaming/shared';
import { CONFIG_PATH } from '../env.js';
import { synthesizeWithTikTok, TtsError } from '../tts/tiktokProvider.js';

/**
 * Union of every code seen across the maintained community lists plus the
 * catalogue this project ships. Codes that don't exist simply come back
 * rejected, so casting a wide net costs nothing but time.
 */
const CANDIDATES: string[] = [
  // --- English (US), numbered ---
  'en_us_001', 'en_us_002', 'en_us_006', 'en_us_007', 'en_us_009', 'en_us_010',
  // --- English (US), named ---
  'en_male_narration', 'en_male_funny', 'en_female_emotional', 'en_male_cody',
  'en_female_samc', 'en_male_jomboy', 'en_male_ad_spokesman', 'en_male_deadpool',
  'en_male_trevor', 'en_male_grinch', 'en_male_ukbutler', 'en_male_ukneighbor',
  'en_female_shenna', 'en_female_richgirl', 'en_female_makeup', 'en_female_grandma',
  'en_male_wizard', 'en_male_cupid', 'en_male_pirate', 'en_male_ghosthost',
  'en_female_madam_leota', 'en_male_santa', 'en_male_santa_narration',
  'en_male_santa_effect', 'en_female_pansino', 'en_male_petergriffin',
  'en_male_jarvis', 'en_male_ashmagic', 'en_male_olantekkers', 'en_male_readingnice',
  'en_female_betty', 'en_male_werewolf', 'en_female_ghost', 'en_male_dracula',
  'en_male_ukguy', 'en_female_lady', 'en_male_hero', 'en_male_narration_v2',
  // --- Franchise characters ---
  'en_us_ghostface', 'en_us_chewbacca', 'en_us_c3po', 'en_us_stitch',
  'en_us_stormtrooper', 'en_us_rocket',
  // --- English (UK / AU) ---
  'en_uk_001', 'en_uk_003', 'en_au_001', 'en_au_002',
  // --- Singing ---
  'en_female_f08_salut_damour', 'en_male_m03_lobby', 'en_female_f08_warmy_breeze',
  'en_male_m03_sunshine_soon', 'en_female_ht_f08_glorious',
  'en_male_sing_funny_it_goes_up', 'en_male_m2_xhxs_m03_silly',
  'en_female_ht_f08_wonderful_world', 'en_male_sing_funny_thanksgiving',
  'en_female_ht_f08_halloween', 'en_male_m03_classical', 'en_female_f08_twinkle',
  'en_male_sing_deep_jingle', 'en_female_f08_birthday',
  // --- Other languages (checked for US availability) ---
  'es_002', 'es_mx_002', 'es_male_m3', 'es_female_f6',
  'fr_001', 'fr_002', 'de_001', 'de_002',
  'br_001', 'br_003', 'br_004', 'br_005', 'pt_female_lhays', 'pt_male_bueno',
  'id_001', 'id_male_darma', 'id_female_noor',
  'jp_001', 'jp_003', 'jp_005', 'jp_006', 'jp_female_fujicochan', 'jp_male_matsuo',
  'kr_002', 'kr_003', 'kr_004',
  'BV074_streaming', 'BV075_streaming',
];

const CONCURRENCY = 3;
const PROBE_TEXT = 'test';

function sessionId(): string {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as { tts?: { sessionId?: string } };
    return process.env.TIKTOK_SESSION_ID?.trim() || config.tts?.sessionId?.trim() || '';
  } catch {
    return process.env.TIKTOK_SESSION_ID?.trim() ?? '';
  }
}

interface Outcome {
  code: string;
  ok: boolean;
  bytes: number;
  error?: string;
}

async function probeOnce(code: string, session: string): Promise<Outcome> {
  try {
    const result = await synthesizeWithTikTok(PROBE_TEXT, code, {
      sessionId: session,
      timeoutMs: 12_000,
    });
    return { code, ok: result.audio.length > 0, bytes: result.audio.length };
  } catch (error) {
    return {
      code,
      ok: false,
      bytes: 0,
      error: error instanceof TtsError ? error.code : String(error).slice(0, 60),
    };
  }
}

async function probe(code: string, session: string): Promise<Outcome> {
  const first = await probeOnce(code, session);
  if (first.ok) return first;
  // One retry: a lone rejection under load isn't proof the voice is gone.
  await new Promise((resolve) => setTimeout(resolve, 400));
  return probeOnce(code, session);
}

async function main(): Promise<void> {
  const session = sessionId();
  if (!session) {
    console.error('No session id found — set TIKTOK_SESSION_ID or paste one in the dashboard.');
    process.exitCode = 1;
    return;
  }

  // `--shipped` re-verifies exactly the catalogue in voices.ts, so a stale
  // entry there fails loudly instead of only showing up as a broken rule.
  const shippedOnly = process.argv.includes('--shipped');
  const codes = shippedOnly ? TTS_VOICE_CODES : CANDIDATES;

  console.log(
    `Probing ${codes.length} ${shippedOnly ? 'shipped' : 'candidate'} voices ` +
      `with a ${session.length}-char session\n`,
  );

  const results: Outcome[] = [];
  const queue = [...codes];

  const worker = async (): Promise<void> => {
    for (;;) {
      const code = queue.shift();
      if (!code) return;
      const outcome = await probe(code, session);
      results.push(outcome);
      process.stdout.write(outcome.ok ? '.' : 'x');
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const working = results.filter((r) => r.ok).sort((a, b) => a.code.localeCompare(b.code));
  const dead = results.filter((r) => !r.ok).sort((a, b) => a.code.localeCompare(b.code));

  console.log(`\n\n=== AVAILABLE (${working.length}) ===`);
  for (const r of working) console.log(`  ${r.code.padEnd(34)} ${r.bytes} bytes`);

  console.log(`\n=== UNAVAILABLE (${dead.length}) ===`);
  for (const r of dead) console.log(`  ${r.code.padEnd(34)} ${r.error ?? 'rejected'}`);

  if (shippedOnly) {
    if (dead.length === 0) {
      console.log('\nEvery shipped voice synthesized — the catalogue is accurate.');
    } else {
      console.error(`\n${dead.length} shipped voice(s) no longer work — update voices.ts.`);
      process.exitCode = 1;
    }
    return;
  }

  console.log('\n--- copy into packages/shared/src/voices.ts ---');
  console.log(working.map((r) => `'${r.code}',`).join(' '));
}

main().catch((error: unknown) => {
  console.error('probe failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
