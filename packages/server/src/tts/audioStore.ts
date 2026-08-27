import { randomUUID } from 'node:crypto';

interface StoredAudio {
  buffer: Buffer;
  mimeType: string;
  createdAt: number;
}

/**
 * Synthesized clips live in memory and are handed to the overlay as short-
 * lived URLs. Nothing is written to disk: clips are worthless a few seconds
 * after playback and writing chat audio to disk is a privacy footgun.
 */
export class AudioStore {
  private items = new Map<string, StoredAudio>();

  constructor(
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly maxItems = 200,
  ) {}

  put(buffer: Buffer, mimeType: string): string {
    const id = randomUUID();
    this.items.set(id, { buffer, mimeType, createdAt: Date.now() });
    this.evict();
    return id;
  }

  get(id: string): StoredAudio | undefined {
    return this.items.get(id);
  }

  delete(id: string): void {
    this.items.delete(id);
  }

  private evict(): void {
    const now = Date.now();
    for (const [id, item] of this.items) {
      if (now - item.createdAt > this.ttlMs) this.items.delete(id);
    }
    // Map preserves insertion order, so the front is always the oldest.
    while (this.items.size > this.maxItems) {
      const oldest = this.items.keys().next();
      if (oldest.done) break;
      this.items.delete(oldest.value);
    }
  }

  clear(): void {
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }
}
