import type { Brief } from './agent/match.js';

/** Fictional client brands with a well-known Qloo reference brand. Three expected "Qloo decided" (one per
 *  character) and one honest close call. Verdicts shown on the home page come from the stored match, not from here. */
export const DEMO_BRIEFS: { label: string; expect: string; brief: Brief }[] = [
  { label: 'Pica Pica Fruit Co.', expect: 'itzel-robles', brief: { brandName: 'Pica Pica Fruit Co.', referenceQuery: 'Tajín', category: 'snacks', product: 'chili-lime fruit cups', channels: ['instagram', 'tiktok'], durationMonths: 3 } },
  { label: 'Nokdu Lab', expect: 'ari-tseng', brief: { brandName: 'Nokdu Lab', referenceQuery: 'Innisfree', category: 'skincare', product: 'green tea toner', channels: ['instagram', 'youtube'], durationMonths: 6 } },
  { label: 'North Kiln', expect: 'ingrid-brekkhus', brief: { brandName: 'North Kiln', referenceQuery: 'Le Creuset', category: 'tableware', product: 'stoneware tea set', channels: ['instagram', 'web'], durationMonths: 12 } },
  { label: 'Loma Coffee Gear', expect: 'close call', brief: { brandName: 'Loma Coffee Gear', referenceQuery: 'Blue Bottle Coffee', category: 'coffee equipment', product: 'ceramic pour-over dripper', channels: ['instagram', 'tiktok'], durationMonths: 3 } },
];
