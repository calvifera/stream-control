import { useEffect, useState } from 'react';
import { TTS_VOICES } from '@streaming/shared';
import { api, type ProviderVoice } from './api.js';

export interface VoiceOptions {
  voices: ProviderVoice[];
  loading: boolean;
  error: string | null;
  /** Shaped for the Select control. */
  options: Array<{ value: string; label: string; group: string }>;
}

/**
 * Voices for the active TTS backend.
 *
 * Google enumerates its catalogue live, so the list reflects exactly what the
 * configured key can use. TikTok has no such endpoint and falls back to the
 * verified static catalogue. The browser backend has no server-side list at
 * all — its voices belong to whatever machine renders the overlay.
 */
export function useVoices(provider: string): VoiceOptions {
  const [voices, setVoices] = useState<ProviderVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (provider === 'browser') {
      setVoices([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    void api
      .voices(provider)
      .then((result) => {
        if (!cancelled) setVoices(result.voices);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        // Better a stale TikTok list than an empty dropdown you can't use.
        setVoices(
          provider === 'tiktok'
            ? TTS_VOICES.map((v) => ({ code: v.code, name: v.name, group: v.group }))
            : [],
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [provider]);

  return {
    voices,
    loading,
    error,
    options: voices.map((voice) => ({
      value: voice.code,
      label: voice.name,
      group: voice.group,
    })),
  };
}
