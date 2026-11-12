export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** Cache mémoire TTL avec éviction des entrées les plus anciennes (FIFO). */
export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.store.size;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}
