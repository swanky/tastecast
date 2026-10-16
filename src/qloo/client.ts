import type { KV } from '../store/kv.js';
import type { QlooCallRecord, QlooParams, QlooResponse } from './types.js';

export const QLOO_BASE = 'https://hackathon.api.qloo.com';
export const LEDGER_KEY = 'qloo-ledger.jsonl';

export class QlooError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export class BudgetExceeded extends Error {
  constructor(message: string, public reason: 'total' | 'public' | 'ip' = 'total') { super(message); }
}

export function cacheKey(path: string, params: QlooParams): string {
  const qs = Object.keys(params).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  return `${path}?${qs}`;
}

export interface QlooClientOptions {
  apiKey: string | undefined;
  kv: KV;
  maxCalls?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Log cache hits to the ledger too (default true). Workers sets false to avoid a KV write per page view. */
  logCacheHits?: boolean;
  /** Prepended to every ledger tag, e.g. "public:" on the deployed site. */
  tagPrefix?: string;
  /** Hard cap on network calls whose ledger tag starts with scopePrefix (default tagPrefix): the public sub-budget. */
  scopedMaxCalls?: number;
  /** Ledger tag prefix counted by scopedMaxCalls. Lets "public:mcp:" calls share the "public:" budget. */
  scopePrefix?: string;
  /** Runs before each network call, after the caps pass; may throw BudgetExceeded (per-IP limit). */
  beforeNetwork?: () => Promise<void>;
}

/** Server-side Qloo client. GET only, key in X-Api-Key, no redirects, one 429 retry, cached, budgeted, logged. */
export class QlooClient {
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private maxCalls: number;
  constructor(private o: QlooClientOptions) {
    // Wrapped: calling a detached global fetch throws "Illegal invocation" on Workers.
    this.fetchImpl = o.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
    this.maxCalls = o.maxCalls ?? 300;
  }

  get hasKey() { return Boolean(this.o.apiKey); }

  async networkCallsUsed(): Promise<number> {
    return (await this.usage()).total;
  }

  /** Network calls in the ledger: all of them, and those tagged with tagPrefix. */
  async usage(): Promise<{ total: number; scoped: number }> {
    const net = (await this.o.kv.lines(LEDGER_KEY)).filter((l) => l.includes('"cached":false'));
    const p = this.o.scopePrefix ?? this.o.tagPrefix;
    return { total: net.length, scoped: p ? net.filter((l) => l.includes(`"tag":${JSON.stringify(p).slice(0, -1)}`)).length : net.length };
  }

  async get(path: string, params: QlooParams, tag: string): Promise<{ data: QlooResponse; cached: boolean }> {
    const key = cacheKey(path, params);
    const hit = await this.o.kv.get<QlooResponse>('qloo:' + key);
    if (hit) {
      if (this.o.logCacheHits !== false) await this.log({ tag, path, status: 200, latency_ms: 0, cached: true });
      return { data: hit, cached: true };
    }
    if (!this.o.apiKey) throw new QlooError('QLOO_API_KEY not set', 503);
    const used = await this.usage();
    if (used.total >= this.maxCalls) throw new BudgetExceeded(`Qloo call budget ${this.maxCalls} reached`, 'total');
    if (this.o.scopedMaxCalls !== undefined && used.scoped >= this.o.scopedMaxCalls) throw new BudgetExceeded(`Public Qloo allowance of ${this.o.scopedMaxCalls} calls used`, 'public');
    if (this.o.beforeNetwork) await this.o.beforeNetwork();
    let res = await this.fetchOnce(key, tag, path);
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers.get('retry-after') ?? '1') || 1, 10) * 1000;
      await this.sleep(wait);
      res = await this.fetchOnce(key, tag, path);
    }
    if (res.status >= 300 && res.status < 400) throw new QlooError('Qloo redirect blocked', 502);
    const raw = await res.text();
    const text = this.o.apiKey.length >= 8 ? raw.split(this.o.apiKey).join('<redacted>') : raw;
    if (res.status === 401 || res.status === 403) throw new QlooError('Qloo auth failed', res.status);
    let data: QlooResponse;
    try { data = JSON.parse(text); } catch { throw new QlooError('Qloo returned non-JSON', 502); }
    if (!res.ok) throw new QlooError(`Qloo ${res.status}`, res.status);
    await this.o.kv.set('qloo:' + key, data);
    return { data, cached: false };
  }

  private async fetchOnce(key: string, tag: string, path: string): Promise<Response> {
    const t0 = this.now();
    const res = await this.fetchImpl(QLOO_BASE + key, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'X-Api-Key': this.o.apiKey!, Accept: 'application/json' },
    });
    await this.log({ tag, path, status: res.status, latency_ms: this.now() - t0, cached: false });
    return res;
  }

  private async log(r: Omit<QlooCallRecord, 'at'>) {
    const rec: QlooCallRecord = { at: new Date(this.now()).toISOString(), ...r, tag: (this.o.tagPrefix ?? '') + r.tag };
    await this.o.kv.append(LEDGER_KEY, JSON.stringify(rec));
  }
}

export function entitiesOf(d: QlooResponse) {
  const r = d.results;
  if (Array.isArray(r)) return r;
  return r?.entities ?? [];
}
export function tagsOf(d: QlooResponse) {
  const r = d.results;
  if (Array.isArray(r)) return [];
  return r?.tags ?? [];
}
export function demographicsOf(d: QlooResponse) {
  const r = d.results;
  if (Array.isArray(r)) return [];
  return r?.demographics ?? [];
}
