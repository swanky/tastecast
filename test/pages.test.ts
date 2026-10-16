import { describe, expect, it } from 'vitest';
import { characterView, createApp, validateBrief } from '../src/app.js';
import { QlooClient } from '../src/qloo/client.js';
import { MemoryKV } from '../src/store/kv.js';
import { CHARACTERS } from '../src/domain/characters.js';
import { normName } from '../src/agent/match.js';
import type { CharacterProfile } from '../src/domain/profile.js';

const UUID = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i;
const fakeId = ['AAAAAAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEEEEEEEEEE'].join('-');
const ari = CHARACTERS.find((c) => c.slug === 'ari-tseng')!;
const prof = {
  slug: 'ari-tseng', houseBrandId: fakeId, seeds: [{ id: fakeId, name: 'NewJeans', matchedName: 'NewJeans', type: 'urn:entity:artist' }],
  demo: { age: { '24_and_younger': 0.1, '25_to_29': 0.3, '30_to_34': 0.5, '35_to_44': -0.4, '45_to_54': -0.3, '55_and_older': -0.3 }, female: 0.3 },
  drift: { flagged: true, level: 'drift', message: 'x' },
  tags: [{ id: 'urn:tag:a', name: 'Iconic' }, { id: 'urn:tag:b', name: 'iconic' }, { id: 'urn:tag:c', name: 'worldly' }],
  tasteTags: [], places: [{ name: 'Haneul Park', area: '95 Haneulgongwon-ro' }, { name: 'AROMIND', area: 'Downtown Seoul' }], evidence: [],
} as unknown as CharacterProfile;

describe('character pages', () => {
  it('character view carries no Qloo entity ids, dedupes tags and hides street addresses', () => {
    const v = characterView(ari, prof, [
      { id: 'R1', ref: 'Glossier', resolved: 'Glossier', cat: 'beauty', expect: 'ari', match: 'exact', full: { winner: 'ari', level: 'clear', ranking: [{ c: 'ari', z: 2, score: 0.8 }, { c: 'itzel', z: 1, score: 0.6 }] } },
      { id: 'U1', ref: 'Loma', cat: 'coffee', expect: null, match: 'none' },
    ]);
    expect(JSON.stringify(v)).not.toMatch(UUID);
    expect(v.taste!.cityTags).toEqual(['Iconic', 'Worldly']);
    expect(v.taste!.places.map((p) => p.area)).toEqual(['', 'Downtown Seoul']);
    expect(v.fits.best).toEqual([{ brand: 'Glossier', category: 'beauty', z: 2, rank: 1, of: 2, decided: true }]);
    expect(v.disclosure).toBe('#ad · AI-generated character');
    expect(v.identity).toBe('Original AI character, not a real person.');
    expect(v.images).toHaveLength(6);
    expect(v.reference.src).toMatch(/^\/assets\/characters\/ari-tseng\//);
  });
  it('every character has 6 portfolio images, a reference and a turnaround', () => {
    for (const c of CHARACTERS) { expect(c.images).toHaveLength(6); expect(c.reference.file).toBe('01-reference.jpg'); expect(c.turnaround.file).toBe('turnaround.jpg'); }
  });
  it('character API 404s on unknown slugs', async () => {
    const kv = new MemoryKV();
    const app = createApp({ qloo: new QlooClient({ apiKey: undefined, kv }), kv });
    expect((await app.request('/api/characters/nobody')).status).toBe(404);
    expect((await app.request('/api/characters/ari-tseng')).status).toBe(200);
  });
  it('resolve flags fuzzy-only results instead of implying a match', async () => {
    const kv = new MemoryKV();
    const fetchImpl = (async () => new Response(JSON.stringify({ results: [{ entity_id: 'x1', name: 'Starbucks' }, { entity_id: 'x2', name: 'Blue Bottle Coffee' }] }), { status: 200 })) as never;
    const app = createApp({ qloo: new QlooClient({ apiKey: 'fake-key-for-tests', kv, fetchImpl }), kv });
    const r = await (await app.request('/api/resolve', { method: 'POST', body: JSON.stringify({ query: 'Loma Coffee Gear' }), headers: { 'content-type': 'application/json' } })).json();
    expect(r.candidates.every((c: { exact: boolean }) => !c.exact), JSON.stringify(r)).toBe(true);
    expect(r.message).toContain('No exact match');
    const r2 = await (await app.request('/api/resolve', { method: 'POST', body: JSON.stringify({ query: 'starbucks' }), headers: { 'content-type': 'application/json' } })).json();
    expect(r2.candidates, JSON.stringify(r2)).toHaveLength(2); expect(r2.candidates[0].exact).toBe(true);
  });
  it('a requested character must be a real slug', () => {
    const base = { brandName: 'a', referenceQuery: 'b', channels: ['web'], durationMonths: 3 };
    expect(validateBrief({ ...base, character: 'ari-tseng' }).brief?.character).toBe('ari-tseng');
    expect(validateBrief({ ...base, character: '../etc' }).brief?.character).toBeUndefined();
  });
  it('name matching ignores accents, case and punctuation, but not different names', () => {
    expect(normName('Stüssy')).toBe(normName('Stussy'));
    expect(normName("Arc'teryx")).toBe(normName('Arcteryx'));
    expect(normName('Loma Coffee Gear')).not.toBe(normName('Starbucks'));
  });
});
