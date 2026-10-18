import { CHARACTERS, DISCLOSURE } from '../domain/characters.js';
import type { Channel, MatchCore } from '../agent/match.js';
import type { EndorsementPackage } from './package.js';

export interface LicenseQuote {
  id: string;
  type: 'tastecast.license_quote.v1';
  licensor: string;
  licensee: string;
  character: { slug: string; name: string };
  usage: string;
  channels: Channel[];
  duration: { months: number; starts: 'on signature' };
  price_quote: { amount: number; currency: 'USD'; basis: string; charged: false; payment_request: null };
  approvals: { character_operator: false; brand: false };
  disclosure: string;
  qloo_evidence: string[];
  notes: string[];
}

const BASE = { emerging: 400, established: 900 } as const;
const CHANNEL_MULT: Record<Channel, number> = { instagram: 1, tiktok: 1, youtube: 1.3, web: 0.8, ooh: 2 };
export const durationFactor = (m: number) => (m <= 1 ? 1 : m <= 3 ? 2.4 : m <= 6 ? 4 : 7);

export function quote(id: string, m: MatchCore, pkg: EndorsementPackage): LicenseQuote {
  const c = CHARACTERS.find((x) => x.slug === pkg.character.slug)!;
  const chMult = m.brief.channels.reduce((s, ch) => s + CHANNEL_MULT[ch], 0);
  const amount = Math.round(BASE[c.tier] * chMult * durationFactor(m.brief.durationMonths) / 10) * 10;
  return {
    id,
    type: 'tastecast.license_quote.v1',
    licensor: 'SWANKY MODELS (operator of the AI character)',
    licensee: m.brief.brandName,
    character: { slug: c.slug, name: c.name },
    usage: `Sponsored creative featuring ${c.name} for ${m.brief.brandName}'s ${pkg.brand.product}, labeled as an ad by an AI-generated character. Not a testimonial: the character is not a real user of the product.`,
    channels: m.brief.channels,
    duration: { months: m.brief.durationMonths, starts: 'on signature' },
    price_quote: {
      amount, currency: 'USD',
      basis: `${c.tier} tier base ${BASE[c.tier]} × channel weight ${chMult.toFixed(1)} × duration factor ${durationFactor(m.brief.durationMonths)}`,
      charged: false, payment_request: null,
    },
    approvals: { character_operator: false, brand: false },
    disclosure: DISCLOSURE,
    qloo_evidence: [...new Set((m.ranking.find((r) => r.slug === c.slug) ?? m.ranking[0]).why.flatMap((w) => w.sourceIds))],
    notes: ['Price is displayed for the demo and never charged. No payment request is issued.', 'Both approvals must be checked by people before any use.', 'Place, brand and artist names in the package are Qloo-sourced references for mood and location, not endorsements or permissions. The soundtrack is a direction, not cleared music.'],
  };
}
