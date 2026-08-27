import type { TtsOverlaySettings } from '@streaming/shared';
import { useLive } from '../../lib/store.js';
import { useTtsPlayer } from '../../lib/useTtsPlayer.js';

interface Props {
  settings: TtsOverlaySettings;
}

/**
 * The audio sink for the whole system.
 *
 * Add this as a browser source in OBS with "control audio via OBS" enabled and
 * every TTS clip is mixed into your stream. The server sends each clip to
 * exactly one page, preferring a source like this one over the dashboard, so
 * having both open never doubles up the audio.
 */
export function TtsWidget({ settings }: Props): JSX.Element {
  const { tts, config } = useLive();
  // Loudness matching follows the TTS tab. Defaults apply until the socket
  // delivers the config, which only matters for the first clip after a reload.
  const player = useTtsPlayer({
    enabled: config?.tts.normalizeLoudness ?? true,
    gainDb: config?.tts.loudnessGainDb ?? 8,
  });

  const caption = player.speaking ? truncate(player.speaking.text, settings.captionMaxChars) : null;
  const upcoming = settings.showQueue ? (tts?.queue ?? []).slice(0, settings.queueSize) : [];

  return (
    <div className="tts-widget">
      <audio ref={player.audioRef} onEnded={player.onEnded} onError={player.onError} />

      {player.blocked ? (
        <button type="button" className="tts-unlock" onClick={player.unlock}>
          Click to enable audio
        </button>
      ) : null}

      {settings.showCaption && caption ? (
        <div className="tts-caption anim-fade">
          {player.speaking?.username ? (
            <span className="tts-speaker">{player.speaking.username}</span>
          ) : null}
          <span className="tts-text">{caption}</span>
        </div>
      ) : null}

      {upcoming.length > 0 ? (
        <div className="tts-queue">
          {upcoming.map((item) => (
            <div key={item.id} className="tts-queue-item">
              {truncate(item.text, 60)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}
