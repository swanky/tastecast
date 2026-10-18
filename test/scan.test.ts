import { describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('scan-public', () => {
  it('fails on a cache file, entity_id JSON, the key value and UUIDs in any case or without dashes; passes on clean', () => {
    const d = mkdtempSync(join(tmpdir(), 'scan-'));
    try {
    execSync('git init -q', { cwd: d });
    copyFileSync('scripts/scan-public.mjs', join(d, 'scan.mjs'));
    writeFileSync(join(d, 'a.txt'), 'hello');
    expect(spawnSync('node', ['scan.mjs'], { cwd: d, env: { ...process.env, QLOO_API_KEY: 'secret-value-123' } }).status).toBe(0);
    mkdirSync(join(d, 'cache'));
    writeFileSync(join(d, 'cache', 'x.json'), '{}');
    writeFileSync(join(d, 'r.json'), '{"entity_id":"X"}');
    writeFileSync(join(d, 'b.txt'), 'key=secret-value-123');
    writeFileSync(join(d, 'ids.ts'), `const id = '${'AAAAAAAA'}-${'BBBB-CCCC-DDDD'}-EEEEEEEEEEEE';`);
    writeFileSync(join(d, 'lower.ts'), `const id = '${'aaaaaaaa'}-${'bbbb-cccc-dddd'}-eeeeeeeeeeee';`);
    writeFileSync(join(d, 'dashless.md'), `id ${'a1'.repeat(16)}`);
    writeFileSync(join(d, 'wrangler.toml'), `[[kv_namespaces]]\nid = "${'b2'.repeat(16)}"\n`);
    const r = spawnSync('node', ['scan.mjs'], { cwd: d, env: { ...process.env, QLOO_API_KEY: 'secret-value-123' }, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('cache/x.json');
    expect(r.stderr).toContain('r.json');
    expect(r.stderr).toContain('b.txt');
    expect(r.stderr).toContain('ids.ts');
    expect(r.stderr).toContain('lower.ts');
    expect(r.stderr).toContain('dashless.md');
    expect(r.stderr).not.toContain('wrangler.toml');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
