import { describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('scan-public', () => {
  it('fails on a cache file, entity_id JSON and the key value; passes on clean', () => {
    const d = mkdtempSync(join(tmpdir(), 'scan-'));
    execSync('git init -q', { cwd: d });
    copyFileSync('scripts/scan-public.mjs', join(d, 'scan.mjs'));
    writeFileSync(join(d, 'a.txt'), 'hello');
    expect(spawnSync('node', ['scan.mjs'], { cwd: d, env: { ...process.env, QLOO_API_KEY: 'secret-value-123' } }).status).toBe(0);
    mkdirSync(join(d, 'cache'));
    writeFileSync(join(d, 'cache', 'x.json'), '{}');
    writeFileSync(join(d, 'r.json'), '{"entity_id":"X"}');
    writeFileSync(join(d, 'b.txt'), 'key=secret-value-123');
    writeFileSync(join(d, 'ids.ts'), `const id = '${'AAAAAAAA'}-${'BBBB-CCCC-DDDD'}-EEEEEEEEEEEE';`);
    const r = spawnSync('node', ['scan.mjs'], { cwd: d, env: { ...process.env, QLOO_API_KEY: 'secret-value-123' }, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('cache/x.json');
    expect(r.stderr).toContain('r.json');
    expect(r.stderr).toContain('b.txt');
    expect(r.stderr).toContain('ids.ts');
  });
});
