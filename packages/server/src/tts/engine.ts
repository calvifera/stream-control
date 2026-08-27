import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { TtsConfig, TtsProvider, TtsQueueItem, TtsState } from '@streaming/shared';
import { createLogger, describeError } from '../logger.js';
import { AudioStore } from './audioStore.js';
import { ProviderRegistry, TtsProviderError } from './providers/index.js';

const log = createLogger('tts');

export interface EnqueueRequest {
  ruleId: string;
  ruleName: string;
  text: string;
  voice: string;
  priority: number;
  volume: number;
  rate: number;
  pitch: number;
  username: string;
  /** Speaker's own backend. Omitted or null uses the globally configured one. */
  provider?: TtsProvider | null;
}

/** Outcome of an immediate, queue-jumping playback request. */
export interface PreviewResult {
  /** The clip now playing, or null when nothing was played. */
  item: TtsQueueItem | null;
  /** Why nothing played. Null on success. */
  reason: string | null;
}

/** Rough spoken duration, used to size the watchdog when TikTok omits one. */
function estimateDurationMs(text: string): number {
  const words = Math.max(1, text.split(/\s+/).length);
  return Math.round((words / 2.6) * 1000) + 800;
}

/**
 * Owns the speech queue.
 *
 * Playback happens in the browser (an overlay page with an <audio> element),
 * not on the server — streaming software captures the browser source's audio, so routing
 * sound through the machine's speakers isn't needed and would be harder to
 * mix. The server synthesizes, queues, and tells exactly one listener what to
 * play next; the listener acks when it finishes.
 */
export class TtsEngine extends EventEmitter {
  private queue: TtsQueueItem[] = [];
  private speaking: TtsQueueItem | null = null;
  private activeListeners = 0;
  private overlayListeners = 0;
  private lastError: string | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private gapTimer: NodeJS.Timeout | null = null;
  private pumping = false;
  /** Monotonic ticket so a slow preview cannot outlive the press after it. */
  private previewSeq = 0;

  readonly audio = new AudioStore();
  readonly providers: ProviderRegistry;

  constructor(private config: TtsConfig) {
    super();
    this.providers = new ProviderRegistry(config);
  }

  setConfig(config: TtsConfig): void {
    const wasEnabled = this.config.enabled;
    this.config = config;
    this.providers.update(config);
    if (wasEnabled && !config.enabled) this.clear();
    this.emitState();
  }

  /**
   * @param total Every client that can play audio, dashboard included.
   * @param overlayCount Just the real TTS browser sources, for reporting.
   */
  setListenerCount(total: number, overlayCount = total): void {
    const previous = this.activeListeners;
    this.activeListeners = Math.max(0, total);
    this.overlayListeners = Math.max(0, overlayCount);
    this.emitState();
    // A listener just connected and something is waiting — start speaking.
    if (previous === 0 && this.activeListeners > 0) void this.pump();
  }

  getState(): TtsState {
    return {
      enabled: this.config.enabled,
      speaking: this.speaking,
      queue: [...this.queue],
      listeners: this.activeListeners,
      overlayListeners: this.overlayListeners,
      lastError: this.lastError,
    };
  }

  private emitState(): void {
    this.emit('state', this.getState());
  }

  private createItem(request: EnqueueRequest): TtsQueueItem {
    return {
      id: randomUUID(),
      ruleId: request.ruleId,
      ruleName: request.ruleName,
      text: request.text,
      voice: request.voice,
      provider: request.provider ?? this.config.provider,
      priority: request.priority,
      volume: request.volume,
      rate: request.rate,
      pitch: request.pitch,
      createdAt: Date.now(),
      audioUrl: null,
      durationMs: null,
      username: request.username,
    };
  }

  /** Starts the "no ack came back" timer for whatever is now playing. */
  private armWatchdog(item: TtsQueueItem): void {
    const budget = (item.durationMs ?? estimateDurationMs(item.text)) + 10_000;
    this.watchdog = setTimeout(() => {
      log.warn(`No playback ack for "${item.text.slice(0, 40)}" — advancing the queue`);
      this.finishCurrent();
    }, budget);
  }

  enqueue(request: EnqueueRequest): TtsQueueItem | null {
    if (!this.config.enabled) return null;

    const item = this.createItem(request);

    // Higher priority first; equal priorities keep arrival order.
    const insertAt = this.queue.findIndex((q) => q.priority < item.priority);
    if (insertAt === -1) this.queue.push(item);
    else this.queue.splice(insertAt, 0, item);

    if (this.queue.length > this.config.maxQueueLength) {
      // Drop from the tail: lowest priority, most recently added.
      const dropped = this.queue.splice(this.config.maxQueueLength);
      log.debug(`Queue full, dropped ${dropped.length} item(s)`);
    }

    this.emitState();
    void this.pump();
    return item;
  }

  /**
   * Speaks something immediately, ahead of the queue.
   *
   * Used by the dashboard's test button, where waiting behind a backlog of real
   * chat defeats the point — you press it to hear a voice *now*.
   *
   * Two details make it behave the way you would expect:
   *
   * - Audio is fetched *before* anything is interrupted, so pressing test does
   *   not punch a silent hole in the stream while the provider responds. If
   *   synthesis fails, whatever was playing carries on undisturbed.
   * - Presses supersede each other. Two tests in flight would otherwise race,
   *   and the slower provider response would win by arriving last, so a press
   *   that has been overtaken is discarded rather than played.
   *
   * The queue itself is untouched: the interrupted clip is dropped (as with
   * skip), and normal playback resumes from wherever it was afterwards.
   */
  async speakNow(request: EnqueueRequest): Promise<PreviewResult> {
    if (!this.config.enabled) return { item: null, reason: 'TTS is switched off' };
    if (this.activeListeners === 0) {
      return { item: null, reason: 'Nothing is listening — open the TTS source or this dashboard' };
    }

    const item = this.createItem(request);
    const ticket = (this.previewSeq += 1);

    // 'browser' has no server-side audio to fetch; the client speaks it.
    if (item.provider !== 'browser') {
      const prepared = await this.synthesize(item);
      if (!prepared) {
        this.emitState();
        return { item: null, reason: this.lastError ?? 'Could not synthesize that clip' };
      }
    }

    if (ticket !== this.previewSeq) {
      // A later press already took over while this one was synthesizing.
      this.releaseAudio(item);
      return { item: null, reason: 'Superseded by a newer test' };
    }

    this.interrupt();

    this.speaking = item;
    this.emitState();
    this.emit('play', item);
    this.armWatchdog(item);
    return { item, reason: null };
  }

  /**
   * Stops playback without scheduling the next item.
   *
   * Distinct from `finishCurrent`, which starts the inter-clip gap timer and
   * pumps the queue — exactly what a caller about to play its own clip does
   * not want.
   */
  private interrupt(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    if (this.gapTimer) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
    if (this.speaking) {
      this.emit('stop');
      this.releaseAudio(this.speaking);
      this.speaking = null;
    }
  }

  /** Frees a clip's stored audio; it will never be played again. */
  private releaseAudio(item: TtsQueueItem): void {
    if (!item.audioUrl) return;
    const id = item.audioUrl.split('/').pop()?.replace(/\.mp3$/, '');
    if (id) this.audio.delete(id);
  }

  /** Skips whatever is currently speaking and moves on. */
  skip(): void {
    if (!this.speaking) return;
    log.info(`Skipped "${this.speaking.text.slice(0, 40)}"`);
    this.emit('stop');
    this.finishCurrent();
  }

  clear(): void {
    this.queue = [];
    if (this.speaking) {
      this.emit('stop');
      this.finishCurrent();
    } else {
      this.emitState();
    }
  }

  /** Called when a listener reports playback finished. */
  reportDone(id: string): void {
    if (this.speaking?.id !== id) return;
    this.finishCurrent();
  }

  /** Called when a listener's <audio> element errored. */
  reportError(id: string, message: string): void {
    if (this.speaking?.id !== id) return;
    this.lastError = message;
    log.warn(`Playback failed for "${this.speaking.text.slice(0, 40)}": ${message}`);
    this.finishCurrent();
  }

  private finishCurrent(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    const finished = this.speaking;
    this.speaking = null;
    // The clip has served its purpose; free it rather than wait for the TTL.
    if (finished) this.releaseAudio(finished);
    this.emitState();

    if (this.gapTimer) clearTimeout(this.gapTimer);
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      void this.pump();
    }, this.config.gapMs);
  }

  private dropExpired(): void {
    const cutoff = Date.now() - this.config.itemTtlSeconds * 1000;
    const before = this.queue.length;
    this.queue = this.queue.filter((item) => item.createdAt >= cutoff);
    if (this.queue.length !== before) {
      log.debug(`Dropped ${before - this.queue.length} item(s) older than the queue TTL`);
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.speaking || this.gapTimer) return;
    if (!this.config.enabled) return;

    this.pumping = true;
    try {
      this.dropExpired();

      if (this.queue.length === 0) {
        this.emitState();
        return;
      }

      if (this.activeListeners === 0) {
        // Nothing can play it. Either hold the queue (so opening the overlay
        // catches up) or let items age out silently.
        if (this.config.skipWhenNoListener) {
          this.queue = [];
          this.emitState();
        }
        return;
      }

      const item = this.queue.shift();
      if (!item) return;

      if (item.provider !== 'browser') {
        const prepared = await this.synthesize(item);
        if (!prepared) {
          this.emitState();
          // Move straight on to the next item rather than stalling the queue.
          setImmediate(() => void this.pump());
          return;
        }
      }

      this.speaking = item;
      this.emitState();
      this.emit('play', item);
      this.armWatchdog(item);
    } finally {
      this.pumping = false;
    }
  }

  /** Mutates `item` with an audio URL, or returns false if it should be dropped. */
  private async synthesize(item: TtsQueueItem): Promise<boolean> {
    const adapter = this.providers.get(item.provider);
    if (!adapter) {
      // 'browser' has no server-side adapter; the overlay speaks it directly.
      return true;
    }

    try {
      const result = await adapter.synthesize({
        text: item.text,
        voice: item.voice,
        rate: item.rate,
        pitch: item.pitch,
      });

      const id = this.audio.put(result.audio, result.mimeType);
      item.audioUrl = `/api/tts/audio/${id}.mp3`;
      item.durationMs = result.durationMs;

      // Whatever the provider baked into the audio must not be applied again
      // during playback — Google shifts pitch server-side, TikTok cannot.
      if (result.rateApplied) item.rate = 1;
      if (result.pitchApplied) item.pitch = 1;

      this.lastError = null;
      return true;
    } catch (error) {
      const message = describeError(error);
      this.lastError = message;

      if (this.config.fallbackToBrowser) {
        log.warn(`${adapter.name} failed (${message}) — falling back to browser speech`);
        item.provider = 'browser';
        item.audioUrl = null;
        // The browser applies rate and pitch itself, so leave them intact.
        return true;
      }

      const code = error instanceof TtsProviderError ? error.code : 'unknown';
      log.error(`Dropping "${item.text.slice(0, 40)}" (${code})`, error);
      this.emit('failed', { item, message });
      return false;
    }
  }

  dispose(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    if (this.gapTimer) clearTimeout(this.gapTimer);
    this.audio.clear();
  }
}
