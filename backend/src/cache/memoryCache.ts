export class MemoryCache<T> {
  private values = new Map<string, { expiresAt: number; value: T }>();

  constructor(private readonly maxEntries?: number) {}

  has(key: string): boolean {
    const entry = this.values.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.values.delete(key);
      return false;
    }
    this.values.delete(key);
    this.values.set(key, entry);
    return true;
  }

  get(key: string): T | null {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.values.delete(key);
      return null;
    }
    this.values.delete(key);
    this.values.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlSeconds: number): void {
    if (this.values.has(key)) this.values.delete(key);
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    this.evictOverflow();
  }

  private evictOverflow(): void {
    if (!this.maxEntries) return;
    while (this.values.size > this.maxEntries) {
      const oldestKey = this.values.keys().next().value;
      if (oldestKey === undefined) return;
      this.values.delete(oldestKey);
    }
  }
}
