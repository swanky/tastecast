import type { QlooParams } from '../qloo/types.js';

export interface Evidence {
  id: string;
  step: string;
  endpoint: string;
  params: Record<string, string>;
  results: string[];
  cached: boolean;
  note?: string;
}

export class EvidenceLedger {
  items: Evidence[] = [];
  constructor(private names: Map<string, string> = new Map()) {}
  nameIds(ids: Record<string, string>) { for (const [id, n] of Object.entries(ids)) this.names.set(id, n); }
  add(step: string, endpoint: string, params: QlooParams, results: string[], cached: boolean, note?: string): string {
    const id = `ev${this.items.length + 1}`;
    const display: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      display[k] = v.split(',').map((x) => this.names.get(x) ?? x).join(', ');
    }
    this.items.push({ id, step, endpoint, params: display, results: results.slice(0, 10), cached, note });
    return id;
  }
}
