import type { KV } from './kv.js';
import { linesKey, storageKey } from './keys.js';

/** The subset of the Workers KV binding this adapter uses (kept local so tsc does not need workers-types). */
export interface KVNamespaceLike {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** Workers KV adapter behind the same KV interface as MemoryKV and FileKV.
 *  Values are JSON. An append-only log is one JSON array per log key (read, push, write): fine for a
 *  low-traffic demo, but KV is eventually consistent, so concurrent appends from different regions can
 *  lose a line. The Qloo client therefore only appends network calls in Workers (logCacheHits:false). */
export class WorkersKV implements KV {
  constructor(private ns: KVNamespaceLike) {}
  async get<T>(key: string) {
    const v = await this.ns.get(await storageKey(key), 'json');
    return (v ?? undefined) as T | undefined;
  }
  async set<T>(key: string, value: T) { await this.ns.put(await storageKey(key), JSON.stringify(value)); }
  async append(key: string, line: string) {
    const arr = await this.lines(key);
    arr.push(line);
    await this.ns.put(linesKey(key), JSON.stringify(arr));
  }
  async lines(key: string) {
    const v = await this.ns.get(linesKey(key), 'json');
    return Array.isArray(v) ? (v as string[]) : [];
  }
}
