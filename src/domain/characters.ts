import type { AgeBucket } from '../qloo/types.js';

export const DISCLOSURE = '#ad · AI-generated character';

export interface Seed { name: string; type: 'urn:entity:artist' | 'urn:entity:brand' | 'urn:entity:movie' | 'urn:entity:tv_show' }

export interface CharacterDef {
  slug: string;
  name: string;
  city: string;
  statedAge: number;
  ageBucket: AgeBucket;
  gender: 'female' | 'male';
  role: string;
  bio: string;
  signature: string[];
  niches: string[];
  seeds: Seed[];
  houseBrand: string;
  /** Approved v5 portfolio (6). Web-size files are committed in public/assets/characters/<slug>/ (built by scripts/build-assets.py). */
  images: { file: string; alt: string; title: string }[];
  /** Approved v3 full-body reference (identity master) and v5 turnaround sheet. */
  reference: { file: string; alt: string };
  turnaround: { file: string; alt: string };
  tagline: string;
  tier: 'emerging' | 'established';
}

export const CHARACTERS: CharacterDef[] = [
  {
    slug: 'itzel-robles', name: 'Itzel Robles', city: 'Mexico City', statedAge: 27, ageBucket: '25_to_29', gender: 'female',
    role: 'Ceramicist and zine maker, Roma Norte',
    bio: 'Grew up in Roma Norte. Fires pottery in a shared kiln by day, sells cups and self-printed zines at the Sunday market, and spins records at a friend\'s bar some nights. She only works with brands whose things show the hand that made them, and she knows, and jokes, that she is an AI character.',
    signature: ['One two-finger platinum streak on her right side', 'Small gold hoop in her left ear', 'Tiny scar through her left eyebrow'],
    niches: ['Coffee and homeware', 'Workwear and streetwear', 'Local music and markets', 'Film cameras'],
    seeds: [
      { name: 'Ed Maverick', type: 'urn:entity:artist' }, { name: 'Girl Ultra', type: 'urn:entity:artist' },
      { name: 'Cuco', type: 'urn:entity:artist' }, { name: 'Dickies', type: 'urn:entity:brand' },
    ],
    houseBrand: 'Dickies', tier: 'emerging',
    images: [
      { file: '02-hero.jpg', alt: 'Itzel sits on sunlit stone steps in Roma Norte holding a terracotta cup', title: 'Roma Norte steps' },
      { file: '03-kiln.jpg', alt: 'Itzel in profile loading a glazed bowl into a kiln', title: 'The shared kiln' },
      { file: '04-market.jpg', alt: 'Itzel laughing with a customer at her market stall', title: 'Sunday market' },
      { file: '05-street.jpg', alt: 'Itzel crossing a tree-lined street, glancing back', title: 'Colonia Juárez crossing' },
      { file: '06-product.jpg', alt: 'Itzel pouring water into a ceramic pour-over dripper', title: 'Pour-over, for a brief' },
      { file: '07-rooftop.jpg', alt: 'Itzel seated on a Mexico City rooftop parapet', title: 'The azotea' },
    ],
    reference: { file: '01-reference.jpg', alt: 'Itzel Robles, full-length studio reference: Itzel standing, facing the camera, neutral expression' },
    turnaround: { file: 'turnaround.jpg', alt: 'Itzel Robles head turnaround sheet: front, three-quarter, profile and back views, plus over-the-shoulder, laughing and downcast expressions' },
    tagline: 'Ceramicist, zine maker and Sunday-market regular from Roma Norte.',
  },
  {
    slug: 'ari-tseng', name: 'Ari Tseng', city: 'Seoul', statedAge: 23, ageBucket: '24_and_younger', gender: 'female',
    role: 'Eyewear and skincare design intern, Seongsu-dong',
    bio: 'Taipei-born, studying and interning in Seoul. Sketches frames in a Seongsu studio, walks Cheonggyecheon at golden hour and eats at Mangwon Market. Her taste reads older than her age on Qloo, and TasteCast shows that openly as a Drift Check instead of hiding it.',
    signature: ['Small beauty mark under her left eye', 'Thin beaded silver ear-climber on her left ear', 'Faint freckles, thick straight brows'],
    niches: ['Eyewear', 'Skincare', 'Stationery and design objects', 'Indie music'],
    seeds: [
      { name: 'Twenty-Five Twenty-One', type: 'urn:entity:tv_show' }, { name: 'NewJeans', type: 'urn:entity:artist' },
      { name: 'Sunset Rollercoaster', type: 'urn:entity:artist' }, { name: 'ADER error', type: 'urn:entity:brand' },
    ],
    houseBrand: 'ADER error', tier: 'emerging',
    images: [
      { file: '02-hero.jpg', alt: 'Ari leaning on a concrete pillar in a Seongsu gallery', title: 'Seongsu gallery' },
      { file: '03-studio.jpg', alt: 'Ari sketching eyeglass frames at a studio desk', title: 'Frame sketches' },
      { file: '04-cheonggyecheon.jpg', alt: 'Ari from behind on a footbridge over the Cheonggyecheon stream', title: 'Cheonggyecheon footbridge' },
      { file: '05-product.jpg', alt: 'Ari inspecting a pair of frames against window light', title: 'Checking the lenses, for a brief' },
      { file: '06-euljiro.jpg', alt: 'Ari laughing while walking through a Euljiro printing alley at dusk', title: 'Euljiro print alley, dusk' },
      { file: '07-mangwon.jpg', alt: 'Ari blowing on a bowl of soup at a Mangwon Market stall', title: 'Mangwon Market' },
    ],
    reference: { file: '01-reference.jpg', alt: 'Ari Tseng, full-length studio reference: Ari standing, facing the camera, neutral expression' },
    turnaround: { file: 'turnaround.jpg', alt: 'Ari Tseng head turnaround sheet: front, three-quarter, profile and back views, plus over-the-shoulder, laughing and downcast expressions' },
    tagline: 'Eyewear design intern in Seongsu, with taste that reads older than her age.',
  },
  {
    slug: 'ingrid-brekkhus', name: 'Ingrid Brekkhus', city: 'London', statedAge: 61, ageBucket: '55_and_older', gender: 'female',
    role: 'Ceramicist and mature model, East London',
    bio: 'Born in Bergen, moved to London at thirty and runs her own pottery studio in East London. A street photographer shot her on the South Bank at sixty and she started modelling. Her rule: she only endorses things she would use herself, and no anti-ageing products.',
    signature: ['Long straight silver-white hair', 'Classic red lipstick', 'Oversized menswear tailoring'],
    niches: ['Tableware and tea', 'Quality basics', 'Eyewear', 'Museums and culture', 'Travel'],
    seeds: [
      { name: 'Joni Mitchell', type: 'urn:entity:artist' }, { name: 'Nick Cave & the Bad Seeds', type: 'urn:entity:artist' },
      { name: 'Margaret Howell', type: 'urn:entity:brand' }, { name: 'Phantom Thread', type: 'urn:entity:movie' },
    ],
    houseBrand: 'Margaret Howell', tier: 'established',
    images: [
      { file: '02-hero.jpg', alt: 'Ingrid throwing a tall vessel on a potter\'s wheel', title: 'At the wheel' },
      { file: '03-gallery.jpg', alt: 'Ingrid from behind studying a large abstract painting', title: 'White-wall gallery' },
      { file: '04-canal.jpg', alt: 'Ingrid laughing in profile on a London canal towpath', title: 'Canal towpath' },
      { file: '05-product.jpg', alt: 'Ingrid pouring tea from a stoneware teapot', title: 'Tea, for a brief' },
      { file: '06-reading.jpg', alt: 'Ingrid in a leather wing chair looking out of a window', title: 'Islington window' },
      { file: '07-mews.jpg', alt: 'Ingrid in a camel trench coat holding a box of pottery in a cobbled mews', title: 'Hackney mews' },
    ],
    reference: { file: '01-reference.jpg', alt: 'Ingrid Brekkhus, full-length studio reference: Ingrid standing, facing the camera, neutral expression' },
    turnaround: { file: 'turnaround.jpg', alt: 'Ingrid Brekkhus head turnaround sheet: front, three-quarter, profile and back views, plus over-the-shoulder, laughing and downcast expressions' },
    tagline: 'Bergen-born potter in East London who started modelling at sixty.',
  },
];

export const TAG_TYPES = 'urn:tag:style:qloo,urn:tag:aesthetic_property:qloo,urn:tag:personal_style:qloo,urn:tag:lifestyle:qloo';
