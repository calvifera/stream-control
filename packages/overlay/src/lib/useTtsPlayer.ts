import { useEffect, useRef, useState } from 'react';
import type { TtsQueueItem } from '@streaming/shared';
import { onTtsPlay, onTtsStop, reportTtsDone, reportTtsError } from './store.js';
import { needsPitchShift, playWithPitch, type PitchedPlayback } from '../overlay/pitch.js';
import { createLoudnessChain, type LoudnessOptions } from '../overlay/loudness.js';

export interface TtsPlayerState {
  /** The clip currently playing on this page, if any. */
  speaking: TtsQueueItem | null;
  /** True when the browser refused to autoplay and needs a real click. */
  blocked: boolean;
  /** Call from a click handler to grant autoplay permission. */
  unlock: () => void;
  /** Attach to an <audio> element this page renders. */
  audioRef: React.RefObject<HTMLAudioElement>;
  onEnded: () => void;
  onError: () => void;
}

/**
 * Plays TTS clips pushed from the server.
 *
 * Shared by the TTS overlay (the OBS audio sink) and the dashboard (which acts
 * as a fallback so speech is audible before any browser source is set up).
 * The server decides which single page receives a clip, so mounting this in
 * both places never doubles the audio.
 */
export function useTtsPlayer(loudness: LoudnessOptions = { enabled: true, gainDb: 8 }): TtsPlayerState {
  const [speaking, setSpeaking] = useState<TtsQueueItem | null>(null);
  const [blocked, setBlocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentId = useRef<string | null>(null);
  const pitchedRef = useRef<PitchedPlayback | null>(null);
  /*
   * The <audio> element is routed through Web Audio so the same loudness
   * chain applies whether or not a clip needs pitch shifting. A media element
   * can only ever have one source node, and creating it detaches the element
   * from the default output, so it is built once and reused.
   */
  const graphRef = useRef<{ context: AudioContext; input: AudioNode } | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const loudnessRef = useRef(loudness);
  loudnessRef.current = loudness;

  const attachGraph = (element: HTMLAudioElement): void => {
    if (graphRef.current) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // No Web Audio: fall back to the element's own output.
    try {
      const context = (contextRef.current ??= new Ctor());
      /*
       * Creating a MediaElementAudioSourceNode permanently detaches the
       * element from the default output, and there is no way back. If the
       * context is suspended — a browser source has no user gesture to
       * resume it — that would turn every clip into silence. So only take
       * the element over once the context is confirmed running; until then
       * clips play unprocessed, which is quiet but audible.
       */
      if (context.state !== 'running') {
        void context.resume().catch(() => undefined);
        return;
      }
      const input = createLoudnessChain(context, loudnessRef.current);
      context.createMediaElementSource(element).connect(input);
      graphRef.current = { context, input };
    } catch {
      // Already attached, or refused. Playback still works unprocessed.
    }
  };

  useEffect(() => {
    const finish = (id: string): void => {
      if (currentId.current !== id) return;
      currentId.current = null;
      pitchedRef.current = null;
      setSpeaking(null);
      reportTtsDone(id);
    };

    const unsubscribePlay = onTtsPlay((item) => {
      currentId.current = item.id;
      setSpeaking(item);

      if (item.provider === 'browser') {
        speakWithBrowser(
          item,
          () => finish(item.id),
          (message) => {
            currentId.current = null;
            setSpeaking(null);
            reportTtsError(item.id, message);
          },
        );
        return;
      }

      const audio = audioRef.current;
      if (!audio || !item.audioUrl) {
        reportTtsError(item.id, 'No audio element or clip URL');
        return;
      }

      const fail = (error: unknown): void => {
        // A normal browser tab blocks autoplay until the user interacts.
        // OBS browser sources don't, so this is only seen in the dashboard
        // and in preview tabs.
        const message = error instanceof Error ? error.message : String(error);
        setBlocked(true);
        currentId.current = null;
        setSpeaking(null);
        reportTtsError(item.id, message);
      };

      // A custom pitch needs resampling, which a plain <audio> element can't
      // do — route those through Web Audio instead.
      if (needsPitchShift(item.pitch)) {
        void playWithPitch(
          item.audioUrl,
          { pitch: item.pitch, rate: item.rate, volume: item.volume, loudness: loudnessRef.current },
          () => finish(item.id),
        )
          .then((playback) => {
            pitchedRef.current = playback;
            setBlocked(false);
          })
          .catch(fail);
        return;
      }

      attachGraph(audio);
      void graphRef.current?.context.resume().catch(() => undefined);

      audio.src = item.audioUrl;
      audio.volume = Math.min(1, Math.max(0, item.volume));
      // Keeps the speaker's pitch intact while changing speed.
      audio.preservesPitch = true;
      audio.playbackRate = item.rate;

      void audio
        .play()
        .then(() => setBlocked(false))
        .catch(fail);
    });

    const unsubscribeStop = onTtsStop(() => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
      }
      pitchedRef.current?.stop();
      pitchedRef.current = null;
      window.speechSynthesis?.cancel();
      currentId.current = null;
      setSpeaking(null);
    });

    return () => {
      unsubscribePlay();
      unsubscribeStop();
    };
  }, []);

  const onEnded = (): void => {
    const id = currentId.current;
    if (!id) return;
    currentId.current = null;
    setSpeaking(null);
    reportTtsDone(id);
  };

  const onError = (): void => {
    const id = currentId.current;
    if (!id) return;
    currentId.current = null;
    setSpeaking(null);
    reportTtsError(id, 'Audio element failed to load the clip');
  };

  /**
   * Playing (even a zero-length clip) from inside a real click satisfies the
   * autoplay policy for every later clip on this page.
   */
  const unlock = (): void => {
    const audio = audioRef.current;
    if (audio) void audio.play().catch(() => undefined);
    // Web Audio has its own gate; resume it in the same gesture.
    void import('../overlay/pitch.js').then(({ audioContext }) => {
      const context = audioContext();
      if (context.state === 'suspended') void context.resume();
    });
    setBlocked(false);
  };

  return { speaking, blocked, unlock, audioRef, onEnded, onError };
}

/**
 * Fallback voice using the browser's own speech synthesis. Used when the
 * TikTok endpoint refuses a clip (expired session, blocked region) and
 * `fallbackToBrowser` is on, so the stream keeps talking either way.
 */
function speakWithBrowser(
  item: TtsQueueItem,
  onDone: () => void,
  onError: (message: string) => void,
): void {
  const synth = window.speechSynthesis;
  if (!synth) {
    onError('This browser has no speech synthesis support');
    return;
  }

  const utterance = new SpeechSynthesisUtterance(item.text);
  utterance.volume = Math.min(1, Math.max(0, item.volume));
  utterance.rate = item.rate;
  // SpeechSynthesis has a real pitch control, unlike the audio element path.
  utterance.pitch = Math.min(2, Math.max(0, item.pitch));
  utterance.onend = onDone;
  utterance.onerror = (event) => onError(event.error ?? 'Speech synthesis failed');

  synth.cancel();
  synth.speak(utterance);
}
