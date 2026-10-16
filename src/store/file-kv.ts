import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { KV } from './kv.js';
import { SAFE_NAME } from './keys.js';

/** Node-only KV backed by ./cache (gitignored). Keys map to files; long keys are hashed. */
export class FileKV implements KV {
  constructor(private root: string) {}
  private path(key: string) {
    const [ns, ...rest] = key.split(':');
    const name = rest.join(':');
    const safe = SAFE_NAME.test(name) ? name : createHash('sha256').update(name).digest('hex').slice(0, 24);
    return join(this.root, ns, safe + '.json');
  }
  async get<T>(key: string) {
    try { return JSON.parse(await readFile(this.path(key), 'utf8')) as T; } catch { return undefined; }
  }
  async set<T>(key: string, value: T) {
    const p = this.path(key); await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(value));
  }
  async append(key: string, line: string) {
    const p = join(this.root, key); await mkdir(dirname(p), { recursive: true });
    await appendFile(p, line + '\n');
  }
  async lines(key: string) {
    try { return (await readFile(join(this.root, key), 'utf8')).split('\n').filter(Boolean); } catch { return []; }
  }
}
