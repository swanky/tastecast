#!/usr/bin/env node
// Fails (exit 1) if tracked or staged files would leak the Qloo key, cache/private files, or raw Qloo JSON.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean);
const key = process.env.QLOO_API_KEY;
const problems = [];
for (const f of files) {
  if (/^(cache|private)\//.test(f) || /(^|\/)\.env/.test(f)) problems.push(`${f}: cache/private/env file`);
  let text = '';
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  if (key && key.length > 8 && text.includes(key)) problems.push(`${f}: contains the QLOO_API_KEY value`);
  if (f.endsWith('.json') && /"entity_id"\s*:/.test(text)) problems.push(`${f}: JSON with a Qloo entity_id field`);
  if (!/package-lock\.json$/.test(f) && /\b[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\b/.test(text)) problems.push(`${f}: contains a Qloo-style entity id (UUID)`);
}
if (problems.length) { console.error('scan-public FAILED\n' + problems.join('\n')); process.exit(1); }
console.log(`scan-public OK (${files.length} files)`);
