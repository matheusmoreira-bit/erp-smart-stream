/**
 * Cache repository for external API queries.
 * Provides a configurable TTL cache (default 30 minutes).
 */

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

export class CacheRepository<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private ttlMs: number;

  constructor(ttlMinutes: number = 30) {
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: T): void {
    this.cache.set(key, { data, expiry: Date.now() + this.ttlMs });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }
}

// Singleton caches for different SAP entities (30-min TTL)
export const sapUsersCache = new CacheRepository<SapUser[]>(30);
export const sapSuppliersCache = new CacheRepository<unknown[]>(30);
export const sapItemsCache = new CacheRepository<unknown[]>(30);

export interface SapUser {
  InternalKey: number;
  UserName: string;
  UserCode: string;
  eMail?: string;
  Department?: number;
  Branch?: number;
  Locked: string;
}
