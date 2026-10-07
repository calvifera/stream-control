/**
 * Credentials for the scripts that talk to a real service.
 *
 * They are not in `config.json`, which is sent to every overlay: they live in
 * the secret store, which publishes them onto `process.env` when it loads, and
 * a plain `.env` puts them in the same place. Importing the store is what makes
 * a key saved on the Keys tab visible here, so these scripts find it the same
 * way the server does.
 */
import '../secrets.js';
import { env } from '../env.js';

export const tiktokSessionId = (): string => env.ttSessionId ?? '';

export const googleTtsApiKey = (): string => env.googleTtsApiKey ?? '';
