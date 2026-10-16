import { describe, expect, it } from 'vitest';
import { clientSafe } from '../src/app.js';

const ID = ['9886839E', 'BED5', '45F9', '8703', '0123456789AB'].join('-');
describe('clientSafe', () => {
  it('drops ID-valued fields, filters ID arrays and masks embedded IDs', () => {
    const out = clientSafe({ brand: { id: ID, name: 'Le Creuset' }, seeds: [{ seedId: ID, name: 'x', z: 1 }], ids: [ID, 'keep'], note: `seed ${ID} used`, n: 3 });
    expect(out).toEqual({ brand: { name: 'Le Creuset' }, seeds: [{ name: 'x', z: 1 }], ids: ['keep'], note: 'seed [qloo-id] used', n: 3 });
    expect(JSON.stringify(out)).not.toContain(ID);
  });
});
