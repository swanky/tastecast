import type { Brief } from './agent/match.js';

/** Fictional client brands (the objective, audience, key message, facts and CTA are synthetic examples, flagged
 *  example: true; Loma leaves facts, key message and CTA blank to show "to be supplied") with a well-known Qloo reference brand. Three expected clear fits (one per
 *  character) and one honest close call. Verdicts shown on the home page come from the stored match, not from here. */
export const DEMO_BRIEFS: { label: string; expect: string; brief: Brief }[] = [
  { label: 'Pica Pica Fruit Co.', expect: 'itzel-robles', brief: { brandName: 'Pica Pica Fruit Co.', referenceQuery: 'Tajín', category: 'snacks', product: 'chili-lime fruit cups', channels: ['instagram', 'tiktok'], durationMonths: 3,
    objective: 'launch', audience: 'Snackers in their twenties who like bold street flavours', audienceAge: '25_to_29', keyMessage: 'Fresh fruit with a chili-lime kick, ready to eat', facts: ['Cut fruit with chili-lime seasoning', 'Sold chilled in single cups'], cta: 'Find the new cups in the chiller aisle', example: true } },
  { label: 'Nokdu Lab', expect: 'ari-tseng', brief: { brandName: 'Nokdu Lab', referenceQuery: 'Innisfree', category: 'skincare', product: 'green tea toner', channels: ['instagram', 'youtube'], durationMonths: 6,
    objective: 'consideration', audience: 'Students starting a simple skincare routine', audienceAge: '24_and_younger', keyMessage: 'A light, simple first step after cleansing', facts: ['Alcohol-free formula', '200 ml bottle'], cta: 'Read the full ingredient list', example: true } },
  { label: 'North Kiln', expect: 'ingrid-brekkhus', brief: { brandName: 'North Kiln', referenceQuery: 'Le Creuset', category: 'tableware', product: 'stoneware tea set', channels: ['instagram', 'web'], durationMonths: 12,
    objective: 'awareness', audience: 'Design-minded tea drinkers who buy for the home', audienceAge: '45_to_54', keyMessage: 'Made slowly, for slow afternoons', facts: ['Hand-glazed stoneware', 'Teapot and four cups'], cta: 'Discover the North Kiln collection', example: true } },
  { label: 'Loma Coffee Gear', expect: 'close call', brief: { brandName: 'Loma Coffee Gear', referenceQuery: 'Blue Bottle Coffee', category: 'coffee equipment', product: 'ceramic pour-over dripper', channels: ['instagram', 'tiktok'], durationMonths: 3,
    objective: 'conversion', audience: 'Home brewers upgrading from pods', audienceAge: '25_to_29', example: true } },
];
