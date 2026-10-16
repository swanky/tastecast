export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  append(key: string, line: string): Promise<void>;
  lines(key: string): Promise<string[]>;
}

export class MemoryKV implements KV {
  private m = new Map<string, unknown>();
  private l = new Map<string, string[]>();
  async get<T>(key: string) { return this.m.get(key) as T | undefined; }
  async set<T>(key: string, value: T) { this.m.set(key, structuredClone(value)); }
  async append(key: string, line: string) { const a = this.l.get(key) ?? []; a.push(line); this.l.set(key, a); }
  async lines(key: string) { return [...(this.l.get(key) ?? [])]; }
}
