/** Maps a logical KV key ("qloo:/v2/insights?...") to the storage key used by every backend.
 *  Same rule as the original FileKV layout: "<namespace>/<name>", where names that are not short and
 *  filename-safe are replaced by the first 24 hex chars of their SHA-256. Using one rule means the
 *  Node ./cache directory can be uploaded to Workers KV as-is (scripts/seed-kv.mjs). */
export const SAFE_NAME = /^[\w.-]{1,80}$/;

export async function storageKey(key: string): Promise<string> {
  const [ns, ...rest] = key.split(':');
  const name = rest.join(':');
  if (SAFE_NAME.test(name)) return `${ns}/${name}`;
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name));
  const hex = [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${ns}/${hex.slice(0, 24)}`;
}

/** Append-only logs (the Qloo ledger) live under their own prefix. */
export const linesKey = (key: string) => `lines/${key}`;
