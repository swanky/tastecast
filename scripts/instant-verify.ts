// Proof that a judge's own brief on an instant brand needs no Qloo network call: runs resolve + match through the
// real service against ./cache with networking disabled (any network call throws), using a copy-on-write KV so
// nothing is written. Typed variants (case, accents, aliases) and a different brand, product and channels.
import { QlooClient } from '../src/qloo/client.js';
import { FileKV } from '../src/store/file-kv.js';
import type { KV } from '../src/store/kv.js';
import { createService } from '../src/app.js';
import { INSTANT_BRANDS } from '../src/instant-brands.js';

class Overlay implements KV {
  m = new Map<string, unknown>(); l: string[] = [];
  constructor(private base: FileKV) {}
  async get<T>(k: string) { return (this.m.has(k) ? this.m.get(k) : await this.base.get<T>(k)) as T | undefined; }
  async set<T>(k: string, v: T) { this.m.set(k, v); }
  async append(_k: string, line: string) { this.l.push(line); }
  async lines(k: string) { return [...(await this.base.lines(k)), ...this.l]; }
}
const typed = (q: string, i: number) => [q.toLowerCase(), q.toUpperCase(), ` ${q} `][i % 3].replace('Stussy', 'Stüssy').replace('STUSSY', 'STÜSSY');
let fails = 0;
for (const [i, b] of INSTANT_BRANDS.entries()) {
  const kv = new Overlay(new FileKV('./cache')); let net = 0;
  const qloo = new QlooClient({ apiKey: 'offline', kv, fetchImpl: (async () => { net++; throw new Error('network disabled'); }) as never });
  const svc = createService({ qloo, kv });
  const q = typed(b.query, i);
  const t0 = performance.now();
  const r = await svc.resolve(q);
  const pick = (r.body.candidates as any[])?.find((c) => c.preselected);
  const m = await svc.match({ brandName: `Judge Test ${i}`, referenceQuery: q, category: 'test', product: 'sample product', channels: ['tiktok', 'web'], durationMonths: 6 }, pick?.id);
  const ms = Math.round(performance.now() - t0); const x = m.body as any;
  const okRun = m.status === 200 && m.served === 'live' && x.precomputed === true && r.body.precomputed === true && net === 0;
  if (!okRun) fails++;
  console.log(`${okRun ? 'PASS' : 'FAIL'} typed "${q}" → ${r.body.query}: resolve precomputed ${r.body.precomputed}, match ${m.status} served ${m.served} precomputed ${x.precomputed}, lookups ${x.qloo?.calls} cached ${x.qloo?.cached}, network attempts ${net}, ${ms} ms, verdict ${x.decision?.level} ${x.ranking?.[0]?.name}`);
}
console.log(fails ? `${fails} FAILED` : 'all instant brands served from stored results with 0 network calls');
process.exit(fails ? 1 : 0);
