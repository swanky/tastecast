import { describe, expect, it } from 'vitest';
import { clientSafe } from '../src/app.js';

// Obviously synthetic (repeated characters), built at runtime so the source holds no UUID-shaped string.
const ID = [8, 4, 4, 4, 12].map((n) => 'F'.repeat(n)).join('-');
describe('clientSafe', () => {
  it('drops ID-valued fields, filters ID arrays and masks embedded IDs', () => {
    const out = clientSafe({ brand: { id: ID, name: 'Le Creuset' }, seeds: [{ seedId: ID, name: 'x', z: 1 }], ids: [ID, 'keep'], note: `seed ${ID} used`, n: 3 });
    expect(out).toEqual({ brand: { name: 'Le Creuset' }, seeds: [{ name: 'x', z: 1 }], ids: ['keep'], note: 'seed [qloo-id] used', n: 3 });
    expect(JSON.stringify(out)).not.toContain(ID);
  });
});
