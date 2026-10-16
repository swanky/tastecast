#!/usr/bin/env node
// Builds out/kv-seed.json (gitignored) from ./cache for `wrangler kv bulk put`.
// Keys follow src/store/keys.ts: cache/<ns>/<name>.json -> "<ns>/<name>". The ledger keeps only the
// network-call lines (cached:false), so the 300-call cap on Workers continues from the real count.
// Server-side data only: it goes to the KV namespace, never to public/ or git.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.TASTECAST_CACHE_DIR ?? './cache';
const NAMESPACES = ['profiles', 'robustness', 'match', 'resolve', 'qloo', 's5'];
const out = [];
for (const ns of NAMESPACES) {
  const dir = join(root, ns);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const value = readFileSync(join(dir, f), 'utf8');
    JSON.parse(value);
    out.push({ key: `${ns}/${f.slice(0, -5)}`, value });
  }
}
const ledgerPath = join(root, 'qloo-ledger.jsonl');
const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').split('\n').filter((l) => l.includes('"cached":false')) : [];
out.push({ key: 'lines/qloo-ledger.jsonl', value: JSON.stringify(ledger) });
mkdirSync('out', { recursive: true });
writeFileSync('out/kv-seed.json', JSON.stringify(out));
const counts = Object.fromEntries(NAMESPACES.map((ns) => [ns, out.filter((e) => e.key.startsWith(ns + '/')).length]));
console.log(`out/kv-seed.json: ${out.length} keys`, counts, `ledger network calls: ${ledger.length}`);
