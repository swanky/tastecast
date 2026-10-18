import type { Brief, Channel, Objective } from '../agent/match.js';
import { AGE_BUCKETS, type AgeBucket } from '../qloo/types.js';
import { bucketLabel, type DriftCheck } from '../domain/profile.js';

/**
 * Creative rules that turn Qloo signals and the brief into a script. Everything here is TasteCast's own
 * creative convention (labelled "creative interpretation" in the package), not Qloo data and not a brand fact.
 */

/** What each kind of product looks like on screen, and which Qloo place kinds suit it. First match wins, so coffee gear
 *  ("ceramic pour-over dripper") is coffee before it is tableware. */
export interface ProductKind { key: string; hero: string; set: string; places: RegExp; wardrobe: string }
const KINDS: (ProductKind & { test: RegExp })[] = [
  { key: 'coffee', test: /\b(coffee|espresso|pour-?over|dripper|grinder|kettle|brew)\b/i,
    hero: 'in a close insert, steam in backlight', set: 'a counter by a window', places: /\b(cafe|café|coffee|market|park|street|avenue)\b/i, wardrobe: 'workwear layers in earth tones' },
  { key: 'food', test: /\b(snack|food|fruit|candy|chocolate|sauce|drink|juice|soda|beverage|bakery|cups?)\b/i,
    hero: 'in a close insert, label to camera', set: 'a market table in daylight', places: /\b(market|mercado|park|parque|plaza|street|avenue|cafe|café)\b/i, wardrobe: 'easy daywear that will not compete with the product colours' },
  { key: 'beauty', test: /\b(skin ?care|toner|serum|cream|beauty|cosmetic|makeup|fragrance|perfume|lotion)\b/i,
    hero: 'in a still-life insert, no hands on skin', set: 'a clean shelf by a window', places: /\b(gallery|museum|park|garden|studio|cafe|café|library)\b/i, wardrobe: 'soft neutral knitwear, minimal makeup, skin left natural' },
  { key: 'tableware', test: /\b(tableware|tea ?set|teapot|cups?|mugs?|plates?|bowls?|stoneware|ceramic|kitchen|cookware|homeware)\b/i,
    hero: 'in a slow overhead insert', set: 'a worktable with afternoon light', places: /\b(gallery|museum|garden|park|cafe|café|tea|bakery|market)\b/i, wardrobe: 'tailoring in muted tones that sits well next to glazed stoneware' },
  { key: 'eyewear', test: /\b(eyewear|glasses|sunglasses|frames?|optical)\b/i,
    hero: 'folded, in a macro insert with the hinges in focus', set: 'a design desk', places: /\b(gallery|museum|studio|library|street|park)\b/i, wardrobe: 'clean lines and one strong colour, hair off the face' },
  { key: 'fashion', test: /\b(apparel|clothing|fashion|shoes?|sneakers?|bags?|jackets?|denim|streetwear)\b/i,
    hero: 'on a rail, in a detail insert', set: 'a street corner with texture', places: /\b(street|avenue|plaza|market|park|gallery)\b/i, wardrobe: 'the product is the outfit; everything else stays plain' },
];
const GENERIC: ProductKind = { key: 'generic', hero: 'in a clean close insert, label to camera', set: 'a neutral table in daylight', places: /\b(park|garden|gallery|museum|cafe|café|market|street)\b/i, wardrobe: 'her own signature look, kept simple' };
export function productKind(b: Pick<Brief, 'category' | 'product'>): ProductKind {
  const text = `${b.category} ${b.product}`;
  return KINDS.find((k) => k.test.test(text)) ?? GENERIC;
}

/** Things each character does in her own world (from her operator-written bio), written to work in any of the Qloo
 *  places. She is never shown using the product. */
export const CHARACTER_ACTIONS: Record<string, string[]> = {
  'itzel-robles': ['flips through a stack of her self-printed zines', 'walks past with a tote of wrapped cups from the shared kiln', 'laughs with a friend from the Sunday market', 'sketches a new zine cover'],
  'ari-tseng': ['sketches eyeglass frames in a small notebook', 'walks at golden hour, sketchbook under her arm', 'browses printed postcards', 'talks with a friend from her Seongsu studio'],
  'ingrid-brekkhus': ['studies the glaze on a small pot she made', 'walks in oversized tailoring, a tote of clay tools on her shoulder', 'reads a ceramics journal', 'talks with a younger potter from her studio'],
};

/** Beat plan per objective: what each of the four beats has to do. */
export const BEATS: Record<Objective, { open: string; build: string; product: string; close: string }> = {
  awareness: { open: 'Hook on the character in her world', build: 'Show the taste world the brand shares with her audience', product: 'Product moment with the key message', close: 'Brand end card and CTA' },
  consideration: { open: 'Hook with the question the key message answers', build: 'Show the detail that answers it', product: 'Product moment with the approved facts', close: 'CTA to learn more' },
  launch: { open: 'Tease the product before the reveal', build: 'Build the setting the product belongs to', product: 'Reveal with the key message', close: 'Launch CTA with where to find it' },
  conversion: { open: 'Hook with the reason to act now', build: 'One proof point from the approved facts', product: 'Product with the offer or CTA on screen', close: 'Direct CTA, repeated as a super' },
};

const SHORT_FORM: Channel[] = ['tiktok', 'instagram'];
/** Timecodes and delivery notes that follow the channels in the brief. */
export function channelPlan(channels: Channel[]): { times: [string, string, string, string]; note: string } {
  const short = channels.some((c) => SHORT_FORM.includes(c));
  const notes = [
    short ? 'Vertical 9:16 master for TikTok and Instagram Reels: hook in the first 2 seconds, burned-in captions, key text inside the safe zone.' : '',
    channels.includes('youtube') ? 'YouTube: 16:9 cut of the same beats, plus a 6-second bumper from the open and the end card.' : '',
    channels.includes('web') ? 'Web: silent autoplay loop, so the supers carry the message.' : '',
    channels.includes('ooh') ? 'Out-of-home: three key frames from the product moment and the end card, as stills.' : '',
  ].filter(Boolean);
  return { times: short ? ['0–3s', '3–12s', '12–22s', '22–30s'] : ['0–5s', '5–15s', '15–25s', '25–30s'], note: notes.join(' ') };
}

/** Audience insight from the character's taste skew. It is a warning only when the brief names a target age that
 *  conflicts with it (two or more Qloo age buckets apart). Seeds are operator-chosen proxies, not a real fan base. */
export function audienceInsight(name: string, age: number, drift: DriftCheck | undefined, target?: AgeBucket): { text: string; conflict: boolean } | null {
  if (!drift) return null;
  const peak = drift.seedPeakBucket;
  const base = drift.level === 'none'
    ? `${name}'s taste seeds peak in her own age bracket (${bucketLabel(peak)}).`
    : `${name} is ${age}, and her taste seeds peak at ${bucketLabel(peak)}. The seeds are operator-chosen proxies for her taste, not a fan base.`;
  if (!target) return { text: base, conflict: false };
  const gap = Math.abs(AGE_BUCKETS.indexOf(target) - AGE_BUCKETS.indexOf(peak));
  if (gap >= 2) return { text: `${base} Your campaign targets ${bucketLabel(target)}, ${gap} age brackets away, so weigh this before casting her.`, conflict: true };
  return { text: `${base} That is close to your target audience (${bucketLabel(target)}).`, conflict: false };
}
