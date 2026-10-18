import { BudgetExceeded } from '../qloo/client.js';
import type { KVNamespaceLike } from './workers-kv.js';

export type LimitKind = 'match' | 'resolve';
export const DEFAULT_IP_LIMITS: Record<LimitKind, number> = { match: 20, resolve: 60 };

export async function hashIp(ip: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tastecast-ip:' + ip));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

/** Per-network daily abuse guard for requests that need live Qloo calls (20 live matches and 60 live searches),
 *  generous enough that an office behind one NAT is not blocked. Requests answered from stored results
 *  (demo briefs, cached searches) never reach this, so they cost no KV write and are never limited.
 *  One KV read and one write per live request, and only on its first network call. The IP is stored
 *  only as a hash (SHA-256 with a fixed, public prefix: pseudonymised, not anonymous) and the counter expires after two days. */
export class IpDailyLimit {
  private charged = false;
  constructor(private ns: KVNamespaceLike, private ipHash: string, private kind: LimitKind,
    private limits: Record<LimitKind, number> = DEFAULT_IP_LIMITS, private now: () => number = Date.now) {}

  key() { return `rl/${new Date(this.now()).toISOString().slice(0, 10)}/${this.ipHash}`; }

  async consume() {
    if (this.charged) return;
    const key = this.key();
    const v = ((await this.ns.get(key, 'json')) ?? {}) as Partial<Record<LimitKind, number>>;
    const used = v[this.kind] ?? 0;
    if (used >= this.limits[this.kind]) throw new BudgetExceeded(`Daily ${this.kind} limit for this IP reached`, 'ip');
    v[this.kind] = used + 1;
    await this.ns.put(key, JSON.stringify(v), { expirationTtl: 2 * 24 * 3600 });
    this.charged = true;
  }
}
