/**
 * Brawler pixel-art generator, chunky fighter (pass 3, faithful to reference).
 *
 * References:
 *   - `C:\tools\brawlers\ss\v1imge.jpg`, primary. Short squat fighters with
 *     wide torso, short bent arms, weapon at head level, chunky shoes.
 *   - `C:\tools\brawlers\ss\preview*.webp`, FUMS, for accessory variety ideas.
 *
 * Grid: 24 × 32.
 *
 * Body proportions (reference faithful):
 *   Rows 0-3:   weapon airspace / hair tall bits
 *   Rows 4-11:  head (8 wide × 8 tall, cols 8-15), prominent, ~25% of height
 *   Row  12:    neck (2 wide, cols 11-12)
 *   Rows 13-21: torso, WIDER than head (cols 7-16 = 10 wide × 9 tall)
 *   Row  22:    belt / waist
 *   Rows 23-28: legs (6 tall, two 2-wide legs with 2px gap)
 *   Rows 29-30: shoes (3 wide each, flat, wider than legs)
 *
 * Arms: SHORT and BENT. Right arm raises to head level holding weapon.
 * Left arm bent at side holding optional off-hand item at waist.
 *
 * Weapons held near head level, small, readable. Tip extends 4-6 rows
 * above the hand, not dramatically overhead.
 *
 * All variation axes preserved: gender, species, skin, hair style/color,
 * expression, facial hair (prominent beards), outfit (tunic/tee/striped/
 * tank/suit/chainmail), hat, accessory, face mark, off-hand item, aura,
 * scene, sparkle. Orange pixel-dust overlay for the signature reference
 * look.
 */

export type RarityTier = 'common' | 'uncommon' | 'rare' | 'legendary' | 'epic' | 'king';

export interface BrawlerArtOpts {
  tokenId: number;
  weaponName: string;
  rarity?: RarityTier | undefined;
  isDead?: boolean | undefined;
  /** Optional override, render the background as if this rarity, while
   * the brawler itself uses the main `rarity`. Used by /sample10 to swap
   * epic chief's brawler render to match rare chief while keeping the
   * 6-cross epic bg. */
  bgRarity?: RarityTier | undefined;
}

// Map a rarity tier to its signature background scene. Mirrors the logic
// in rollFeatures so callers can override the bg independently.
export function sceneForRarity(rarity: RarityTier): Scene {
  if (rarity === 'king') return 'diamondblue';
  if (rarity === 'epic') return 'epicbg';
  if (rarity === 'legendary') return 'legendarybg';
  if (rarity === 'rare') return 'rarebg';
  if (rarity === 'uncommon') return 'uncommonbg';
  return 'commonbg';
}

const W = 24;
const H = 32;

// ─── Anchors (single source of truth) ─────────────────────────────────
// Head is a clean 8-wide × 8-tall rounded block. Torso is slightly wider
// at the shoulders. Legs short, feet wider than legs.

const CX = 11; // body centerline (between col 11 and 12 visually)

// Head: cols 8-15 (8 wide), rows 4-11 (8 tall).
const HEAD_LEFT = 8;
const HEAD_RIGHT = 15;
const HEAD_TOP = 4;
const HEAD_BOTTOM = 11;

// Neck: 2 wide centered, row 12.
const NECK_Y = 12;

// Torso: cols 7-16 (10 wide), rows 13-21 (9 tall). Belt at row 22.
const TORSO_LEFT = 7;
const TORSO_RIGHT = 16;
const TORSO_TOP = 13;
const TORSO_BOTTOM = 21;
const BELT_Y = 22;

// Legs: two 2-wide columns (cols 9-10, cols 13-14), rows 23-28.
const LEG_LEFT_A = 9;
const LEG_LEFT_B = 10;
const LEG_RIGHT_A = 13;
const LEG_RIGHT_B = 14;
const LEG_TOP = 23;
const LEG_BOTTOM = 28;

// Shoes: 3 wide each, rows 29-30.
const SHOE_Y = 29;

// Right arm (viewer's left), raised, bent at elbow.
// Shoulder at col 7, row 13. Elbow at col 5, row 11. Hand at col 5, row 9.
// Weapon grip at (5, 9); tip extends up to row 3-5.
const R_HAND = { x: 5, y: 9 };

// Left arm (viewer's right), lowered, slightly bent.
// Shoulder at col 16, row 13. Hand at col 18, row 18.
const L_HAND = { x: 18, y: 18 };

// ─── RNG / pick helpers ───────────────────────────────────────────────

function lcg(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = Math.imul(state, 1664525) + 1013904223;
    state = state >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length]!;
}

function chance(rng: () => number, p: number): boolean {
  return rng() < p;
}

// ─── Palettes ──────────────────────────────────────────────────────────

interface SkinPalette {
  base: string;
  shade: string;
  line: string;
}

// Tuned from reference, warm tans, peaches, browns, some deeper tones.
const SKIN_PALETTES: readonly SkinPalette[] = [
  { base: '#E8B088', shade: '#B8785A', line: '#3A1E10' }, // light tan
  { base: '#E8A070', shade: '#B4703A', line: '#3A1A08' }, // peach
  { base: '#D4905A', shade: '#A06038', line: '#2E1608' }, // tan brown
  { base: '#B8794A', shade: '#84522A', line: '#2A1408' }, // medium
  { base: '#8C5A38', shade: '#5A3620', line: '#1E0E04' }, // brown
  { base: '#60402A', shade: '#3C2618', line: '#180A02' }, // dark
  { base: '#F2D6B3', shade: '#C09470', line: '#3A2010' }, // pale
];

const HAIR_COLORS: readonly string[] = [
  '#1a1a1a', // black
  '#3A2010', // dk brown
  '#6E4018', // brown
  '#B87038', // auburn
  '#D8A030', // blonde
  '#F4D048', // platinum
  '#BA2A2A', // red (mohawk)
  '#5A3A88', // purple
  '#2A8ABB', // teal
  '#808080', // grey
];

// Lighter purple base per D's 2026-04-25 feedback, pops the bright
// character colors. Slight saturation shifts per rarity but the hue stays
// consistent for collection cohesion.
const RARITY_BG: Record<RarityTier, string> = {
  common: '#4A2C7A', // mid-purple
  uncommon: '#502E84',
  rare: '#56308C', // royal plum, lighter
  legendary: '#5C3494', // brighter
  epic: '#6A3AA8', // amethyst
  king: '#56308C', // royal plum (king carries gold accents inline)
};

const RARITY_AURA: Record<RarityTier, string | null> = {
  common: null,
  uncommon: '#4A9EFF',
  rare: '#B866E8',
  legendary: '#FFA040',
  epic: '#FF5050',
  king: '#FFD84A',
};

interface OutfitPalette {
  primary: string;
  shadow: string;
  accent: string;
}

// Reference-matched outfit colors: rich tunic-browns, suit-navies,
// striped-reds, ochres.
const OUTFIT_PALETTES: Record<RarityTier, readonly OutfitPalette[]> = {
  common: [
    { primary: '#7A5030', shadow: '#422818', accent: '#D4A878' }, // tunic brown (Knox-style)
    { primary: '#2A3A50', shadow: '#141E2C', accent: '#FFFFFF' }, // navy
    { primary: '#5A2A2A', shadow: '#301414', accent: '#FFFFFF' }, // maroon
    { primary: '#4A4A4A', shadow: '#1E1E1E', accent: '#CCCCCC' }, // grey
    { primary: '#3A5020', shadow: '#1E2E10', accent: '#D4C878' }, // olive
    { primary: '#9A6030', shadow: '#5A3A18', accent: '#E4C49A' }, // rust
  ],
  uncommon: [
    { primary: '#1E3A70', shadow: '#0E1E3C', accent: '#FFD84A' }, // royal blue (Hank-style)
    { primary: '#5A3A20', shadow: '#2C1C10', accent: '#FFFFFF' },
    { primary: '#4A5070', shadow: '#202540', accent: '#C8D0E8' },
    { primary: '#2A5A5A', shadow: '#123030', accent: '#8AE0E0' },
    { primary: '#503070', shadow: '#28183A', accent: '#FFFFFF' },
  ],
  rare: [
    { primary: '#6A2A8A', shadow: '#381846', accent: '#FFD84A' },
    { primary: '#8A5020', shadow: '#462A10', accent: '#FFE088' },
    { primary: '#1A3A1A', shadow: '#0C2010', accent: '#D4FF70' },
    { primary: '#7A2030', shadow: '#3E1018', accent: '#FFFFFF' },
  ],
  legendary: [
    { primary: '#A86A20', shadow: '#60360F', accent: '#FFD84A' },
    { primary: '#7A1A1A', shadow: '#400A0A', accent: '#FFFFFF' },
    { primary: '#6A6A6A', shadow: '#3A3A3A', accent: '#FFD84A' }, // chainmail grey (Marco-style)
  ],
  epic: [
    { primary: '#C0303A', shadow: '#6A141A', accent: '#FFD84A' },
    { primary: '#1A1A1A', shadow: '#000000', accent: '#FF3A3A' },
    { primary: '#2A2A6A', shadow: '#14143A', accent: '#FFD84A' },
  ],
  king: [{ primary: '#8A1040', shadow: '#500820', accent: '#FFD84A' }],
};

// Pants, dark navies / browns / blacks, matching the reference.
const PANTS_PALETTES: readonly { primary: string; shadow: string }[] = [
  { primary: '#1A2A50', shadow: '#0E1830' }, // navy (most common in reference)
  { primary: '#2A1F18', shadow: '#141008' }, // dark brown
  { primary: '#3A3020', shadow: '#201810' }, // khaki
  { primary: '#2A2A2A', shadow: '#101010' }, // charcoal
  { primary: '#5A3A20', shadow: '#2A1E10' }, // tan pants
  { primary: '#1A1A1A', shadow: '#000000' }, // black
];

const SHOE_COLORS: readonly string[] = ['#1A1A1A', '#3A2010', '#6A3A18', '#E0E0E0', '#C13E3E'];

const PUPIL_COLORS: readonly string[] = [
  '#0a0a0a',
  '#1a3a5a',
  '#205a28',
  '#8a1a1a',
  '#6a4a1a',
];

/**
 * Pupil pool used when the skin is dark, bright contrasting colors so the
 * face reads even at thumbnail size. White makes any character pop on a
 * dark background; the colored options give variety.
 */
const BRIGHT_PUPIL_COLORS: readonly string[] = [
  '#FFFFFF', // white, highest contrast
  '#FFD84A', // gold
  '#6AE0FF', // cyan
  '#F0F0F0', // off-white
];

/** Crude brightness check on a hex color, used to detect dark skin. */
function isDarkSkin(hex: string): boolean {
  // Strip leading '#'.
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Threshold tuned against SKIN_PALETTES, anything below ~330 sum is
  // dark enough that a dark pupil disappears into the face.
  return r + g + b < 330;
}

// ─── Feature types + rolling ───────────────────────────────────────────

type Gender = 'm' | 'f';
type Species = 'normal' | 'zombie' | 'vampire' | 'ghost' | 'robot';

/**
 * Fighter archetypes, each picks a cohesive bundle of outfit/hat/hair/
 * accessory/palette so the rendered character reads as a recognizable
 * trope instead of a random mashup. D's 2026-04-25 ask: "model on actual
 * brawlers, pirates, ninjas, street fighters, jail thugs, wrestlers, boxers".
 */
export type Archetype =
  | 'brawler'    // default street fighter, tank top, bandana, mohawk-ready
  | 'pirate'     // striped shirt, eyepatch, earring, beard, bandana
  | 'ninja'      // black suit, ninja mask, dark bandana
  | 'thug'       // prison stripes (black/white or orange jumpsuit), beanie
  | 'wrestler'   // lucha tank top, long hair, bandage, bright red/blue
  | 'boxer'      // red/blue/black tank, buzz cut, headband
  | 'cowboy'     // tunic + cowboy hat + beard
  | 'knight'     // chainmail + helmet or crown
  | 'punjab'     // Punjabi warrior, turban + big beard, white/orange tunic
  | 'samurai'    // Japanese warrior, hachimaki + dark tunic + red sash
  | 'mafia'      // gangster, fedora + pinstripe suit
  | 'viking'     // horned helmet + fur tunic + long hair
  | 'spartan'    // Corinthian helmet with red crest + bronze armor
  | 'berserker'  // shirtless + war paint + wild hair
  | 'mongol'     // round fur hat + leather tunic
  | 'royal';     // king only

type HairStyle =
  | 'none'
  | 'buzz'
  | 'short'
  | 'messy'
  | 'long'
  | 'mohawk'
  | 'fauxhawk'
  | 'bun'
  | 'ponytail';

type Expression = 'neutral' | 'focused' | 'squint' | 'grin';
type FacialHair = 'none' | 'moustache' | 'beard' | 'goatee' | 'bigbeard';
type HatKind =
  | 'none'
  | 'beanie'
  | 'bandana'
  | 'cap'
  | 'tophat'
  | 'crown'
  | 'kingcrown'
  | 'helmet'
  | 'cowboy'
  | 'turban'        // Punjabi turban, big wrapped fabric, jewel center
  | 'topknot'       // samurai topknot, small bun on top of bald-ish head
  | 'hachimaki'     // samurai headband, thin cloth with center accent
  | 'piratehat'     // tricorn pirate hat with skull dot
  | 'fedora'        // mafia fedora, wide brim, white band
  | 'horned'        // viking horned helmet
  | 'spartanhelmet' // Corinthian helmet with red mohawk crest (legacy)
  | 'feather'       // Indian chief feather headband
  | 'furhat';       // Mongol papakha, round fur cap
type OutfitKind = 'tunic' | 'tee' | 'striped' | 'tank' | 'suit' | 'chainmail' | 'shirtless' | 'tribal';
type Aura = 'none' | 'spark' | 'fire' | 'halo';
type Scene =
  | 'none'
  | 'stars'
  | 'moon'
  | 'sun'
  | 'curtains'
  | 'clouds'
  | 'rain'
  | 'city'
  | 'lightning'
  | 'sunset'
  | 'diamondblue'
  | 'commonbg'
  | 'uncommonbg'
  | 'rarebg'
  | 'legendarybg'
  | 'epicbg';
type OffHand =
  | 'none'
  | 'bottle'
  | 'torch'
  | 'lantern'
  | 'coinbag'
  | 'chalice'
  | 'book'
  | 'staff';
type FaceMark = 'none' | 'scar' | 'freckles' | 'warpaint' | 'bandage' | 'mask';
type Pet = 'none' | 'dog' | 'cat';
type Accessory = 'none' | 'eyepatch' | 'earring' | 'necklace' | 'cigar' | 'glasses';

interface Features {
  archetype: Archetype;
  rarity: RarityTier;
  gender: Gender;
  species: Species;
  skin: SkinPalette;
  outfit: OutfitKind;
  outfitPalette: OutfitPalette;
  pants: { primary: string; shadow: string };
  shoeColor: string;
  hair: HairStyle;
  hairColor: string;
  hatKind: HatKind;
  hatColor: string;
  hatAccent: string;
  expression: Expression;
  pupilColor: string;
  facialHair: FacialHair;
  accessory: Accessory;
  faceMark: FaceMark;
  offHand: OffHand;
  aura: Aura;
  scene: Scene;
  sparkle: boolean;
  pet: Pet;
  hook: boolean;
  glove: boolean;
  /** Tier of decoration. 0 = none, 1 = chest gem only, 2 = gem + corner sparkles, 3 = full bling (gem + sparkles + glittery shirt). */
  blingLevel: 0 | 1 | 2 | 3;
}

// ─── Archetype bundles ────────────────────────────────────────────────

interface ArchetypeSpec {
  outfits: readonly OutfitKind[];
  hats: readonly HatKind[];
  hairs?: readonly HairStyle[];
  facialHairChance: number;
  forceAccessory?: readonly Accessory[];
  palettePool?: readonly OutfitPalette[];
  forceFaceMark?: FaceMark;
  /** Lock the hair to a specific color (boxer's fluro orange). */
  forceHairColor?: string;
}

const ARCHETYPE_SPECS: Record<Archetype, ArchetypeSpec> = {
  brawler: {
    outfits: ['tank', 'tee'],
    hats: ['bandana', 'cap', 'none'],
    hairs: ['buzz', 'short', 'mohawk', 'fauxhawk', 'messy'],
    facialHairChance: 0.4,
  },
  pirate: {
    outfits: ['striped', 'tunic'],
    hats: ['piratehat'], // ALWAYS the tricorn, pirate signature
    hairs: ['long', 'messy', 'ponytail'],
    facialHairChance: 0.75,
    // Earring only, eyepatch was covering the centered NARROW_EYES so the
    // visible eye sat off to viewer's right. Both eyes now visible, centered.
    forceAccessory: ['earring'],
    forceFaceMark: 'none', // no white scar/mark on cheek, D's 2026-04-26 callout
    palettePool: [
      { primary: '#9A3030', shadow: '#5A1818', accent: '#FFFFFF' }, // red + white stripes
      { primary: '#2A4A80', shadow: '#14243A', accent: '#FFFFFF' }, // blue + white stripes
      { primary: '#6A4820', shadow: '#3A2818', accent: '#E4C49A' }, // tan tunic
    ],
  },
  ninja: {
    outfits: ['tunic'], // tunic only, no suit/tie
    hats: ['bandana', 'none'],
    hairs: ['short', 'none'],
    facialHairChance: 0,
    forceFaceMark: 'mask',
    palettePool: [
      { primary: '#1A1A1A', shadow: '#000000', accent: '#C13E3E' },
      { primary: '#1A1A2E', shadow: '#0A0A14', accent: '#FFFFFF' },
      { primary: '#2A1A2A', shadow: '#14101A', accent: '#C13E3E' },
    ],
  },
  thug: {
    outfits: ['striped'],
    hats: ['beanie', 'none'],
    hairs: ['buzz', 'short'],
    facialHairChance: 0.55,
    palettePool: [
      { primary: '#1A1A1A', shadow: '#000000', accent: '#FFFFFF' }, // black/white prison
      { primary: '#F4A830', shadow: '#B47010', accent: '#1A1A1A' }, // orange jumpsuit
      { primary: '#5A5A5A', shadow: '#2A2A2A', accent: '#FFFFFF' }, // grey jumpsuit
    ],
  },
  wrestler: {
    outfits: ['tank'],
    hats: ['bandana', 'none'],
    hairs: ['long', 'messy', 'mohawk'],
    facialHairChance: 0.5,
    palettePool: [
      { primary: '#C13E3E', shadow: '#7A1818', accent: '#FFD84A' },
      { primary: '#2A5AC0', shadow: '#143478', accent: '#FFD84A' },
      { primary: '#FFD84A', shadow: '#A07C10', accent: '#1A1A1A' },
      { primary: '#2A8A3A', shadow: '#165020', accent: '#FFD84A' },
    ],
  },
  boxer: {
    outfits: ['shirtless'], // shirtless with trunks + champion belt
    hats: ['bandana', 'none'],
    hairs: ['buzz', 'short'],
    facialHairChance: 0.15,
    forceHairColor: '#FF6A1A', // fluro orange, D's 2026-04-27 callout
    palettePool: [
      { primary: '#C13E3E', shadow: '#7A1818', accent: '#FFD84A' }, // red trunks
      { primary: '#1E3A70', shadow: '#0E1E3C', accent: '#FFD84A' }, // blue trunks
      { primary: '#1A1A1A', shadow: '#000000', accent: '#FFD84A' }, // black trunks
    ],
  },
  cowboy: {
    outfits: ['tunic', 'suit'],
    hats: ['cowboy'], // ALWAYS cowboy hat, already locked
    hairs: ['messy', 'short', 'long'],
    facialHairChance: 0.75,
  },
  knight: {
    outfits: ['chainmail', 'suit'],
    hats: ['helmet', 'crown', 'tophat'],
    hairs: ['none'],
    facialHairChance: 0.35,
    palettePool: [
      { primary: '#8A8A8A', shadow: '#4A4A4A', accent: '#FFD84A' },
      { primary: '#6A6A6A', shadow: '#3A3A3A', accent: '#C13E3E' },
      { primary: '#A86A20', shadow: '#60360F', accent: '#FFD84A' }, // golden armor
    ],
  },
  royal: {
    outfits: ['suit'],
    hats: ['kingcrown'],
    hairs: ['none'],
    facialHairChance: 0.5,
    palettePool: [{ primary: '#8A1040', shadow: '#500820', accent: '#FFD84A' }],
  },
  punjab: {
    outfits: ['tunic', 'suit'],
    hats: ['turban'],
    hairs: ['none'], // hair is hidden by the turban
    facialHairChance: 0.85, // big beards are part of the look
    palettePool: [
      { primary: '#E04A28', shadow: '#8A2810', accent: '#FFD84A' }, // saffron orange
      { primary: '#1A6A3A', shadow: '#0E3A1E', accent: '#FFD84A' }, // dark green
      { primary: '#1A3A6A', shadow: '#0E1E3C', accent: '#FFFFFF' }, // royal blue
      { primary: '#6A2A2A', shadow: '#3A1414', accent: '#FFD84A' }, // maroon
    ],
  },
  samurai: {
    outfits: ['tunic'],
    hats: ['hachimaki'], // ALWAYS Japan headband, no more topknot
    hairs: ['none'],
    facialHairChance: 0.25,
    forceFaceMark: 'none',
    palettePool: [
      { primary: '#1A1A2A', shadow: '#0A0A14', accent: '#C13E3E' }, // black with red sash
      { primary: '#2A1A2A', shadow: '#14101A', accent: '#FFD84A' }, // dark plum + gold
      { primary: '#3A1A1A', shadow: '#1A0A0A', accent: '#E6E6E6' }, // crimson + white
      { primary: '#1A2A2A', shadow: '#0A1414', accent: '#C13E3E' }, // teal black + red
    ],
  },
  mafia: {
    outfits: ['suit'],
    hats: ['fedora'], // ALWAYS fedora, gangster signature
    hairs: ['none'], // hidden by fedora
    facialHairChance: 0.4, // Don Corleone moustache vibe
    palettePool: [
      { primary: '#1A1A1A', shadow: '#000000', accent: '#FFFFFF' }, // black pinstripe
      { primary: '#2A2A3A', shadow: '#14141E', accent: '#FFFFFF' }, // dark navy
      { primary: '#3A2A2A', shadow: '#1E1414', accent: '#FFFFFF' }, // smoke grey-brown
    ],
  },
  viking: {
    outfits: ['tunic', 'tank'],
    hats: ['horned'], // ALWAYS horned helmet
    hairs: ['none'], // hidden by helmet
    facialHairChance: 0.85, // big-bearded vikings, but only moustache/goatee per D
    palettePool: [
      { primary: '#5A4030', shadow: '#3A2818', accent: '#A07040' }, // brown leather + tan trim
      { primary: '#4A3020', shadow: '#28180E', accent: '#7A5030' }, // tan furs
      { primary: '#2A2A1A', shadow: '#14140A', accent: '#7A5030' }, // dark grey leather
    ],
  },
  spartan: {
    // 2026-04-26: archetype repurposed as "Indian chief warrior" per D, 
    // feather headband, bare chest with 6-pack, loincloth. Earthy palette.
    // Kept the 'spartan' identifier so existing /sample10 + matchmaking
    // wiring don't churn; UI labels surface "Chief".
    // facialHairChance bumped to 0.85 (viking's value) so the face reads
    // with the same beard/moustache cadence per D's "copy viking face"
    // ask for epic chief. RAISE_MOUTH covers the mouth-row lift below.
    outfits: ['tribal'],
    hats: ['feather'],
    hairs: ['none'],
    facialHairChance: 0.85,
    palettePool: [
      { primary: '#6A4828', shadow: '#3A2818', accent: '#C13E3E' }, // tan leather + red
      { primary: '#8C5A38', shadow: '#5A3620', accent: '#FFD84A' }, // brown + gold
      { primary: '#A86838', shadow: '#5A3620', accent: '#C13E3E' }, // light tan + red
    ],
  },
  berserker: {
    outfits: ['shirtless'], // bare chest like boxer but wilder
    hats: ['none'], // wild hair, no hat
    hairs: ['long', 'messy', 'mohawk'],
    facialHairChance: 0, // war paint owns the face, no facial hair
    forceFaceMark: 'warpaint', // red cheek stripes
    palettePool: [
      { primary: '#5A2020', shadow: '#2A1010', accent: '#FFD84A' }, // blood-red trunks
      { primary: '#3A2A1A', shadow: '#1A140A', accent: '#C13E3E' }, // brown leather trunks
      { primary: '#2A2A2A', shadow: '#0A0A0A', accent: '#C13E3E' }, // black warrior trunks
    ],
  },
  mongol: {
    outfits: ['tunic'],
    hats: ['furhat'], // ALWAYS papakha
    hairs: ['none'],
    facialHairChance: 0.7, // wispy moustache classic Mongol look
    palettePool: [
      { primary: '#7A4828', shadow: '#3A2810', accent: '#C13E3E' }, // tan + red sash
      { primary: '#5A3A20', shadow: '#2A1810', accent: '#FFD84A' }, // brown + gold
      { primary: '#2A4828', shadow: '#142810', accent: '#FFD84A' }, // forest green
    ],
  },
};

function pickArchetype(rng: () => number, rarity: RarityTier): Archetype {
  if (rarity === 'king') return 'royal';
  const pools: Record<Exclude<RarityTier, 'king'>, readonly Archetype[]> = {
    common: ['brawler', 'thug', 'boxer', 'cowboy', 'mongol'],
    uncommon: [
      'brawler', 'pirate', 'thug', 'boxer', 'cowboy',
      'punjab', 'viking', 'mongol',
    ],
    rare: [
      'pirate', 'ninja', 'wrestler', 'cowboy', 'knight',
      'punjab', 'samurai', 'viking', 'mafia', 'mongol',
      'berserker', 'spartan',
    ],
    legendary: [
      'ninja', 'pirate', 'wrestler', 'knight', 'samurai',
      'punjab', 'viking', 'mafia', 'berserker', 'spartan',
    ],
    epic: [
      'ninja', 'knight', 'wrestler', 'samurai',
      'spartan', 'berserker',
    ],
  };
  return pick(rng, pools[rarity]);
}

/**
 * Public helper: returns the archetype that would be rolled for a given
 * (tokenId, rarity). Used by /sample10 to find concrete tokenIds matching
 * each archetype.
 */
export function archetypeFor(tokenId: number, rarity: RarityTier): Archetype {
  const rng = lcg(tokenId * 2654435761 + 17);
  // Burn the same number of rng() calls that rollFeatures does before
  // pickArchetype, so the result matches what gets actually rolled.
  rng(); // gender
  return pickArchetype(rng, rarity);
}

function rollFeatures(tokenId: number, rarity: RarityTier): Features {
  const rng = lcg(tokenId * 2654435761 + 17);

  const gender: Gender = chance(rng, 0.5) ? 'm' : 'f';
  // Species variants (zombie/ghost/robot/vampire) were noisy and mis-drew
  // the face. Dropped per D's 2026-04-25 feedback. Keep the field around
  // so the type surface is stable, but always roll 'normal'.
  const species: Species = 'normal';

  const archetype = pickArchetype(rng, rarity);
  const spec = ARCHETYPE_SPECS[archetype];

  // Skin selection, most archetypes pick freely from the full palette so
  // the collection has full diversity. Punjabi/samurai are biased to skin
  // tones that match the archetype. King is pinned for collection consistency.
  const skin: SkinPalette = (() => {
    if (rarity === 'king') return SKIN_PALETTES[1]!;
    if (archetype === 'punjab') {
      // Brown / dark tones for Punjabi characters (palette indices 2-5).
      const pool = [SKIN_PALETTES[2]!, SKIN_PALETTES[3]!, SKIN_PALETTES[4]!, SKIN_PALETTES[5]!];
      return pick(rng, pool);
    }
    if (archetype === 'samurai') {
      // Lighter tones for samurai (light tan, peach, pale).
      const pool = [SKIN_PALETTES[0]!, SKIN_PALETTES[1]!, SKIN_PALETTES[6]!];
      return pick(rng, pool);
    }
    return pick(rng, SKIN_PALETTES);
  })();

  const outfit = pick(rng, spec.outfits);
  const outfitPalette = spec.palettePool
    ? pick(rng, spec.palettePool)
    : pick(rng, OUTFIT_PALETTES[rarity]);
  const pants = pick(rng, PANTS_PALETTES);
  const shoeColor = pick(rng, SHOE_COLORS);

  const hatKind = pick(rng, spec.hats);
  // Hat colors:
  //   - turban: bright wrap palette (white/saffron/gold/green/maroon)
  //   - piratehat: always black (classic tricorn)
  //   - fedora: neutral dark (black/dark grey/dark brown), mafia clean look
  //   - furhat: brown/black fur (Mongol papakha)
  //   - horned + spartanhelmet: hardcoded metals inside drawHat (no color
  //     pick used)
  //   - everything else: neutrals (black/red/white/brown) so combos with
  //     bright outfits don't read as glitch stripes
  const hatColor =
    hatKind === 'turban'
      ? pick(rng, ['#E6E6E6', '#E04A28', '#FFD84A', '#1A6A3A', '#6A2A2A'])
      : hatKind === 'piratehat'
        ? '#1A1A1A'
        : hatKind === 'fedora'
          ? pick(rng, ['#1A1A1A', '#2A2A2A', '#3A2618'])
          : hatKind === 'furhat'
            ? pick(rng, ['#3A2010', '#1A1A1A', '#5A3A20'])
            : pick(rng, ['#1A1A1A', '#C13E3E', '#E6E6E6', '#3A2618']);
  const hatAccent = pick(rng, ['#FFFFFF', '#FFD84A']);

  // Hats that completely cover the hairline:
  const hairHidden =
    hatKind === 'helmet' ||
    hatKind === 'kingcrown' ||
    hatKind === 'turban' ||
    hatKind === 'topknot' ||
    hatKind === 'piratehat' ||
    hatKind === 'fedora' ||
    hatKind === 'horned' ||
    hatKind === 'spartanhelmet' ||
    hatKind === 'feather' ||
    hatKind === 'furhat';
  const defaultHairs: readonly HairStyle[] =
    gender === 'f'
      ? ['long', 'bun', 'ponytail', 'messy', 'short']
      : ['buzz', 'short', 'mohawk', 'fauxhawk', 'messy', 'none'];
  const hairPool: readonly HairStyle[] = hairHidden
    ? ['none']
    : spec.hairs
      ? spec.hairs
      : defaultHairs;
  const hair = pick(rng, hairPool);
  const hairColor = spec.forceHairColor ?? pick(rng, HAIR_COLORS);

  // Expressions, clean set only. 'angry' dropped 2026-04-26, its brow row
  // at HEAD_TOP+3 was the main source of the "bandit mask stripe" across
  // the upper face at thumbnail size. 'wide' and 'oneeyed' were already
  // dropped earlier as the "eyes go everywhere" culprits.
  const expression = pick(rng, ['neutral', 'focused', 'squint', 'grin'] as const);
  // Pupil, always dark. White sclera around the pupil (drawn in drawFace)
  // provides contrast against any skin tone, replacing the previous
  // brightPupil hack which gave dark-skinned characters glowing white eyes.
  const pupilColor = pick(rng, PUPIL_COLORS);

  // Facial hair, men only, archetype-biased. Beard + bigbeard removed
  // 2026-04-25 (D's "stuffed the mouths on" feedback). Just two clean
  // options: tiny moustache above the lip, or chin goatee in hair color.
  const facialHair: FacialHair = (() => {
    if (gender !== 'm') return 'none';
    if (rng() >= spec.facialHairChance) return 'none';
    return pick(rng, ['moustache', 'goatee'] as const);
  })();

  // Accessory: archetype-forced or rolled. Eyepatch removed from the random
  // pool 2026-04-29, it was rolling on non-pirates (boxers, cowboys,
  // mafia, kings, samurai, vikings) and read as "the face is munted" since
  // it covers a full eye + adds a strap pixel on a non-themed character.
  // Pirates already get earring via forceAccessory; the eyepatch case in
  // drawAccessory is kept so a pirate spec can opt back in if needed.
  // Dropped 'cigar' + 'glasses' previously for pixel-alignment reasons.
  const accessory: Accessory = spec.forceAccessory
    ? pick(rng, spec.forceAccessory)
    : rng() < 0.18
      ? pick(rng, ['earring', 'necklace'] as const)
      : 'none';

  // Face marks: ninja archetype forces 'mask' (black bar across eye row);
  // otherwise low-chance scar/freckles/bandage.
  const faceMark: FaceMark = spec.forceFaceMark
    ? spec.forceFaceMark
    : rng() < 0.15
      ? pick(rng, ['scar', 'freckles', 'bandage'] as const)
      : 'none';

  // Off-hand items add clutter and never outlined cleanly, removed per feedback.
  const offHand: OffHand = 'none';

  // Aura: only king gets a halo. Spark/fire were messy flames above the hair.
  const aura: Aura = rarity === 'king' ? 'halo' : 'none';

  // Background scenes, only the safe minimalist ones, only on rare+. Stars
  // sit in the corners (cols 1-3 + 19-22, rows 1-10), moon is upper-right
  // (cols 17-21, rows 1-5), sun is upper-left (cols 1-4, rows 1-4), all
  // away from the body silhouette and weapon arc.
  // Each rarity gets a signature background. The pop scales with tier, 
  // common is plain solid, uncommon adds a couple of sparkles, rare adds
  // a facet pattern, legendary adds gold accents, epic gets the most
  // dense + bright bg short of king. King stays at diamondblue (10/10).
  const scene: Scene = (() => {
    if (rarity === 'king') return 'diamondblue';
    if (rarity === 'epic') return 'epicbg';
    if (rarity === 'legendary') return 'legendarybg';
    if (rarity === 'rare') return 'rarebg';
    if (rarity === 'uncommon') return 'uncommonbg';
    return 'commonbg';
  })();

  // Pet companion at the floor next to the legs. Bumped 2026-04-26, at
  // the old rates pets barely showed up in 20-card samples. Now rare gets
  // 50%, legendary 70%, epic 90% so they're a clear "rarity perk".
  const pet: Pet = (() => {
    if (rarity === 'common' || rarity === 'uncommon') return 'none';
    const r = rng();
    if (rarity === 'epic') return r < 0.45 ? 'dog' : r < 0.9 ? 'cat' : 'none';
    if (rarity === 'legendary') return r < 0.35 ? 'dog' : r < 0.7 ? 'cat' : 'none';
    if (rarity === 'rare') return r < 0.25 ? 'dog' : r < 0.5 ? 'cat' : 'none';
    return 'none';
  })();

  // Perimeter sparkles were random colored dots everywhere, removed.
  const sparkle = false;

  // Pirate signature: hook for a left hand. Forced for the archetype.
  const hook = archetype === 'pirate';
  const glove = archetype === 'boxer';

  // Bling reverted 2026-04-25 for the regular collection, D didn't like
  // the chest gem / sparkles / glittery shirt on every brawler. King keeps
  // full bling (level 3) per the 2026-04-26 callout, this is the dev's
  // 1-of-1, "has to be the best".
  const blingLevel: 0 | 1 | 2 | 3 = rarity === 'king' ? 3 : 0;

  return {
    archetype,
    rarity,
    gender,
    species,
    skin,
    outfit,
    outfitPalette,
    pants,
    shoeColor,
    hair,
    hairColor,
    hatKind,
    hatColor,
    hatAccent,
    expression,
    pupilColor,
    facialHair,
    accessory,
    faceMark,
    offHand,
    aura,
    scene,
    sparkle,
    pet,
    hook,
    glove,
    blingLevel,
  };
}

// ─── Cell helpers ──────────────────────────────────────────────────────

interface Cell {
  x: number;
  y: number;
  color: string;
}

function put(cells: Cell[], x: number, y: number, color: string): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  cells.push({ x, y, color });
}

function compact(cells: Cell[]): Cell[] {
  const map = new Map<string, Cell>();
  for (const c of cells) map.set(`${c.x},${c.y}`, c);
  return [...map.values()];
}

// ─── Head / face ───────────────────────────────────────────────────────

function drawHead(cells: Cell[], f: Features): void {
  const { base, shade, line } = f.skin;

  // 8×8 head with corner rounding.
  for (let y = HEAD_TOP; y <= HEAD_BOTTOM; y++) {
    for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
      const cornerY = y === HEAD_TOP || y === HEAD_BOTTOM;
      const cornerX = x === HEAD_LEFT || x === HEAD_RIGHT;
      if (cornerY && cornerX) continue;
      put(cells, x, y, base);
    }
  }

  // Side shading on the right edge ONLY (subtle form, not full chiaroscuro).
  // Removed the jaw/chin shade line 2026-04-26, it stacked with the mouth
  // and facial hair to create a 3-row dark band on the lower face that
  // D called out as "munted".
  for (let y = HEAD_TOP + 1; y <= HEAD_BOTTOM - 1; y++) {
    put(cells, HEAD_RIGHT, y, shade);
  }

  // Head outline pixels at the four corner-adjacent slots for a "rounded"
  // silhouette against dark backgrounds.
  put(cells, HEAD_LEFT + 1, HEAD_TOP, line);
  put(cells, HEAD_RIGHT - 1, HEAD_TOP, line);
  put(cells, HEAD_LEFT + 1, HEAD_BOTTOM, line);
  put(cells, HEAD_RIGHT - 1, HEAD_BOTTOM, line);

  // Neck, 2 wide in skin shade, connects head to torso
  put(cells, CX, NECK_Y, shade);
  put(cells, CX + 1, NECK_Y, shade);
}

// 2026-04-29: D's call, eyes and mouth on the SAME grid position for
// every brawler, full stop. The per-(archetype, rarity) tweaks
// (RAISE_MOUTH / MOUTH_OFFSETS / NARROW_EYES) added too many edge cases
// without pulling their weight. Faces now have one eye row and one mouth
// row, period; variation comes from skin / hair / facialHair only.
//
// Universal placement:
//   eyeY    = HEAD_TOP + 4 = row 8
//   eyeXs   = HEAD_LEFT + 2 = col 10  AND  HEAD_RIGHT - 3 = col 12
//   mouthY  = HEAD_TOP + 6 = row 10  (one row up from chin so it always reads)
//
// Empty sentinels kept so call sites stay simple, if we ever need to
// re-introduce a tweak it'd go in here.
const RAISE_MOUTH: ReadonlySet<string> = new Set();
const MOUTH_OFFSETS: ReadonlyMap<string, number> = new Map();
const NARROW_EYES: ReadonlySet<string> = new Set();
const X_MOUTH: ReadonlySet<string> = new Set();

function drawFace(cells: Cell[], f: Features): void {
  const line = f.skin.line;
  const cellKey = `${f.archetype}:${f.rarity}`;
  const mouthDy = MOUTH_OFFSETS.get(cellKey) ?? (RAISE_MOUTH.has(cellKey) ? -1 : 0);
  const pupilColor = f.pupilColor;
  const mouthColor = line;
  const eyeY = HEAD_TOP + 4;
  // NARROW_EYES pulls pupils inward to cols 11 + 12 (touching at the center
  // line). Default keeps them at cols 10 + 12 with col 11 of skin between.
  const narrow = NARROW_EYES.has(cellKey);
  const lEyeX = narrow ? CX : HEAD_LEFT + 2;       // 11 narrow, 10 default
  const rEyeX = narrow ? CX + 1 : HEAD_RIGHT - 3;  // 12 either way

  // Eyes, each eye is 2 pixels: white sclera on the OUTER side, dark pupil
  // on the inner side. The white anchors the eye against any skin tone or
  // background so it doesn't vanish at thumbnail size.
  const drawEye = (pupilX: number, scleraOffset: -1 | 1) => {
    put(cells, pupilX + scleraOffset, eyeY, '#FFFFFF');
    put(cells, pupilX, eyeY, pupilColor);
  };

  switch (f.expression) {
    case 'neutral':
    case 'focused':
    case 'grin':
      drawEye(lEyeX, -1); // sclera at col 9, pupil at col 10
      drawEye(rEyeX, +1); // sclera at col 13, pupil at col 12
      break;
    case 'squint':
      // Closed eyes, sclera + dark eyelid line on top. Without the white
      // sclera underneath, dark-skinned brawlers' squint pixels matched the
      // skin tone exactly and the face read as eyeless. Drawing the eye
      // first then stamping line over the pupil keeps the eye SHAPE while
      // signaling "closed".
      drawEye(lEyeX, -1);
      drawEye(rEyeX, +1);
      put(cells, lEyeX, eyeY, line);
      put(cells, rEyeX, eyeY, line);
      break;
  }

  // 2026-04-29: universal mouth row. Was HEAD_TOP+7 (chin) + per-cell tweaks;
  // now fixed at HEAD_TOP+6 (one row above chin) for every brawler so faces
  // are visually consistent across all archetypes.
  const mouthY = HEAD_TOP + 6 + mouthDy;

  // Moustache sits on the upper-lip row, mouth on the lip row below, both
  // ALWAYS rendered together. The previous "moustache stands in for the
  // mouth" behaviour read as "no mouth = munted" once D ran the contact
  // sheet on 2026-04-29. Drawing them stacked makes the lower face read
  // cleanly as facial-hair + open mouth.
  if (f.facialHair === 'moustache') {
    // 2-pixel moustache row just above the lip. Sits at mouthY-1 so it
    // tracks the mouth as the face proportions shift.
    put(cells, CX, mouthY - 1, line);
    put(cells, CX + 1, mouthY - 1, line);
  }

  // Mouth, always drawn. Pirate gets an X-mouth ("dead-eye" /
  // X-marks-the-spot) in place of the standard line. Goatee sits below
  // the mouth on the neck row in drawFace's goatee branch.
  if (X_MOUTH.has(cellKey)) {
    // 5-pixel X centered at (CX, mouthY). Spans 3 rows × 3 cols.
    put(cells, CX - 1, mouthY - 1, mouthColor);
    put(cells, CX + 1, mouthY - 1, mouthColor);
    put(cells, CX, mouthY, mouthColor);
    put(cells, CX - 1, mouthY + 1, mouthColor);
    put(cells, CX + 1, mouthY + 1, mouthColor);
  } else {
    switch (f.expression) {
      case 'grin':
        put(cells, CX - 1, mouthY, mouthColor);
        put(cells, CX, mouthY, '#FFFFFF');
        put(cells, CX + 1, mouthY, mouthColor);
        break;
      default:
        put(cells, CX, mouthY, mouthColor);
        put(cells, CX + 1, mouthY, mouthColor);
        break;
    }
  }

  if (f.facialHair === 'goatee') {
    // Beard hangs off the chin onto the neck row in hair color (D's
    // "yellow goatee style" callout). Sits one row below the head so the
    // mouth remains visible. hairColor over the darker neck shade reads
    // as a clean beard tuft; if it ever vanishes against skin, fall back
    // to the dark line color.
    const beard = f.hairColor === f.skin.shade || f.hairColor === f.skin.base
      ? line
      : f.hairColor;
    put(cells, CX - 1, NECK_Y, beard);
    put(cells, CX, NECK_Y, beard);
    put(cells, CX + 1, NECK_Y, beard);
  }

  // Punjab bindi, red dot in the center of the forehead, between the
  // turban (rows 1-4) and the eyes (row 8). 2-pixel wide so it reads at
  // thumbnail size. Per D's 2026-04-27 ask.
  if (f.archetype === 'punjab') {
    const bindiRed = '#C13E3E';
    put(cells, CX, HEAD_TOP + 2, bindiRed);
    put(cells, CX + 1, HEAD_TOP + 2, bindiRed);
  }
}

function drawHair(cells: Cell[], f: Features): void {
  if (f.hair === 'none') return;
  const c = f.hairColor;

  switch (f.hair) {
    case 'buzz':
      // Thin single-row layer on top
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) {
        put(cells, x, HEAD_TOP, c);
      }
      put(cells, HEAD_LEFT, HEAD_TOP + 1, c);
      put(cells, HEAD_RIGHT, HEAD_TOP + 1, c);
      break;
    case 'short':
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, HEAD_TOP - 1, c);
        put(cells, x, HEAD_TOP, c);
      }
      put(cells, HEAD_LEFT, HEAD_TOP + 1, c);
      put(cells, HEAD_RIGHT, HEAD_TOP + 1, c);
      break;
    case 'messy':
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, HEAD_TOP - 1, c);
        put(cells, x, HEAD_TOP, c);
      }
      // Tufts sticking up
      put(cells, HEAD_LEFT + 1, HEAD_TOP - 2, c);
      put(cells, HEAD_LEFT + 3, HEAD_TOP - 2, c);
      put(cells, HEAD_RIGHT - 2, HEAD_TOP - 2, c);
      break;
    case 'long':
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, HEAD_TOP - 1, c);
        put(cells, x, HEAD_TOP, c);
      }
      // Side curtains down past shoulders
      for (let y = HEAD_TOP + 1; y <= TORSO_TOP + 2; y++) {
        put(cells, HEAD_LEFT - 1, y, c);
        put(cells, HEAD_RIGHT + 1, y, c);
      }
      break;
    case 'mohawk': {
      for (let y = HEAD_TOP - 3; y <= HEAD_TOP; y++) {
        put(cells, CX, y, c);
        put(cells, CX + 1, y, c);
      }
      // Stubble on sides
      put(cells, HEAD_LEFT + 1, HEAD_TOP, f.skin.shade);
      put(cells, HEAD_RIGHT - 1, HEAD_TOP, f.skin.shade);
      break;
    }
    case 'fauxhawk':
      for (let x = HEAD_LEFT + 2; x <= HEAD_RIGHT - 2; x++) {
        put(cells, x, HEAD_TOP - 1, c);
        put(cells, x, HEAD_TOP, c);
      }
      put(cells, CX, HEAD_TOP - 2, c);
      put(cells, CX + 1, HEAD_TOP - 2, c);
      break;
    case 'bun':
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, HEAD_TOP - 1, c);
        put(cells, x, HEAD_TOP, c);
      }
      // Bun
      put(cells, CX, HEAD_TOP - 3, c);
      put(cells, CX + 1, HEAD_TOP - 3, c);
      put(cells, CX - 1, HEAD_TOP - 2, c);
      put(cells, CX, HEAD_TOP - 2, c);
      put(cells, CX + 1, HEAD_TOP - 2, c);
      put(cells, CX + 2, HEAD_TOP - 2, c);
      break;
    case 'ponytail':
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, HEAD_TOP - 1, c);
        put(cells, x, HEAD_TOP, c);
      }
      put(cells, HEAD_LEFT - 1, HEAD_TOP + 1, c);
      put(cells, HEAD_LEFT - 1, HEAD_TOP + 2, c);
      put(cells, HEAD_LEFT - 2, HEAD_TOP + 2, c);
      put(cells, HEAD_LEFT - 2, HEAD_TOP + 3, c);
      break;
  }
}

function drawHat(cells: Cell[], f: Features): void {
  switch (f.hatKind) {
    case 'none':
      return;
    case 'beanie':
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, HEAD_TOP - 1, f.hatColor);
        put(cells, x, HEAD_TOP, f.hatColor);
      }
      put(cells, CX, HEAD_TOP - 2, f.hatAccent);
      return;
    case 'bandana':
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) put(cells, x, HEAD_TOP, f.hatColor);
      put(cells, HEAD_LEFT - 1, HEAD_TOP + 1, f.hatColor);
      return;
    case 'cap':
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) put(cells, x, HEAD_TOP - 1, f.hatColor);
      for (let x = HEAD_LEFT - 1; x <= HEAD_RIGHT + 1; x++) put(cells, x, HEAD_TOP, f.hatColor);
      return;
    case 'tophat':
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) {
        put(cells, x, HEAD_TOP - 3, f.hatColor);
        put(cells, x, HEAD_TOP - 2, f.hatAccent);
        put(cells, x, HEAD_TOP - 1, f.hatColor);
      }
      for (let x = HEAD_LEFT - 1; x <= HEAD_RIGHT + 1; x++) put(cells, x, HEAD_TOP, f.hatColor);
      // Feather (reference #2 style)
      put(cells, HEAD_RIGHT - 1, HEAD_TOP - 4, '#C13E3E');
      return;
    case 'crown':
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) put(cells, x, HEAD_TOP - 1, '#FFD84A');
      put(cells, HEAD_LEFT + 1, HEAD_TOP - 2, '#FFD84A');
      put(cells, CX, HEAD_TOP - 2, '#FFD84A');
      put(cells, HEAD_RIGHT - 1, HEAD_TOP - 2, '#FFD84A');
      return;
    case 'kingcrown':
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, HEAD_TOP - 2, '#FFD84A');
        put(cells, x, HEAD_TOP - 1, '#FFD84A');
      }
      put(cells, HEAD_LEFT + 1, HEAD_TOP - 3, '#FFD84A');
      put(cells, CX, HEAD_TOP - 3, '#FFD84A');
      put(cells, HEAD_RIGHT - 1, HEAD_TOP - 3, '#FFD84A');
      put(cells, CX, HEAD_TOP - 1, '#C13E3E');
      return;
    case 'helmet':
      for (let y = HEAD_TOP - 1; y <= HEAD_BOTTOM; y++) {
        for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
          put(cells, x, y, '#8A8A8A');
        }
      }
      // Visor slot
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) {
        put(cells, x, HEAD_TOP + 4, '#1A1A1A');
      }
      return;
    case 'cowboy':
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) put(cells, x, HEAD_TOP - 2, f.hatColor);
      for (let x = HEAD_LEFT - 2; x <= HEAD_RIGHT + 2; x++) put(cells, x, HEAD_TOP - 1, f.hatColor);
      return;
    case 'turban': {
      // Punjabi turban, 3 rows of wrapped fabric across the head, slight
      // dome shape, jewel/accent at the center crease.
      // Use the outfit's primary color tone for cohesion if the hat color
      // is too neutral.
      const tColor = f.hatColor;
      const accent = f.hatAccent;
      // Top dome row (narrower)
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) {
        put(cells, x, HEAD_TOP - 3, tColor);
      }
      // Main wrap rows (full width)
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, HEAD_TOP - 2, tColor);
        put(cells, x, HEAD_TOP - 1, tColor);
        put(cells, x, HEAD_TOP, tColor); // covers hairline
      }
      // Crease, a 2-px horizontal accent strip mid-turban
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) {
        put(cells, x, HEAD_TOP - 1, accent === '#FFFFFF' ? tColor : accent);
      }
      // Centre jewel (always gold for the regal look)
      put(cells, CX, HEAD_TOP - 2, '#FFD84A');
      put(cells, CX + 1, HEAD_TOP - 2, '#FFD84A');
      return;
    }
    case 'topknot': {
      // Samurai topknot, bald-ish head with a small tied bun on top.
      // Dark hair line + small black bun at center top.
      const hair = '#1A1A1A';
      // Thin hair strip across top of head
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) {
        put(cells, x, HEAD_TOP, hair);
      }
      // Topknot, 2x2 bun at center, sitting one row above the head.
      put(cells, CX, HEAD_TOP - 2, hair);
      put(cells, CX + 1, HEAD_TOP - 2, hair);
      put(cells, CX, HEAD_TOP - 1, hair);
      put(cells, CX + 1, HEAD_TOP - 1, hair);
      return;
    }
    case 'hachimaki': {
      // Samurai headband, single row of cloth across the forehead with a
      // contrasting center dot (kanji/sun emblem).
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, HEAD_TOP + 1, '#E6E6E6');
      }
      // Trailing tail on the left
      put(cells, HEAD_LEFT - 1, HEAD_TOP + 2, '#E6E6E6');
      put(cells, HEAD_LEFT - 1, HEAD_TOP + 3, '#E6E6E6');
      // Red center emblem
      put(cells, CX, HEAD_TOP + 1, '#C13E3E');
      put(cells, CX + 1, HEAD_TOP + 1, '#C13E3E');
      // Show some hair underneath (dark short on the sides)
      put(cells, HEAD_LEFT, HEAD_TOP, '#1A1A1A');
      put(cells, HEAD_RIGHT, HEAD_TOP, '#1A1A1A');
      return;
    }
    case 'piratehat': {
      // Tricorn, flat triangular hat with a wide brim and a small
      // skull-and-crossbones dot. Black with a single white skull pixel
      // for the classic pirate silhouette.
      const c = f.hatColor;
      // Crown peak (single column at center)
      put(cells, CX, HEAD_TOP - 3, c);
      put(cells, CX + 1, HEAD_TOP - 3, c);
      // Crown body
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) {
        put(cells, x, HEAD_TOP - 2, c);
      }
      // Wide brim, extends past the head on both sides
      for (let x = HEAD_LEFT - 2; x <= HEAD_RIGHT + 2; x++) {
        put(cells, x, HEAD_TOP - 1, c);
      }
      // White skull dot at the peak
      put(cells, CX, HEAD_TOP - 2, '#FFFFFF');
      put(cells, CX + 1, HEAD_TOP - 2, '#FFFFFF');
      return;
    }
    case 'fedora': {
      // Mafia fedora, small creased crown + wide flat brim + white band.
      const c = f.hatColor;
      // Crown top (3-wide, narrowest)
      for (let x = HEAD_LEFT + 2; x <= HEAD_RIGHT - 2; x++) {
        put(cells, x, HEAD_TOP - 3, c);
      }
      // Crown body (5-wide)
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) {
        put(cells, x, HEAD_TOP - 2, c);
      }
      // Hat band, single white row inside the crown
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) {
        put(cells, x, HEAD_TOP - 1, '#FFFFFF');
      }
      // Wide brim, extends 1 col past the head on each side
      for (let x = HEAD_LEFT - 1; x <= HEAD_RIGHT + 1; x++) {
        put(cells, x, HEAD_TOP, c);
      }
      return;
    }
    case 'horned': {
      // Viking horned helmet, 2 sharp horns + metal cap with nasal bar.
      const metal = '#7A7A7A';
      const metalDark = '#3A3A3A';
      const horn = '#E4D4A8';
      const hornShade = '#A89060';
      // Horn tips
      put(cells, HEAD_LEFT - 1, HEAD_TOP - 3, horn);
      put(cells, HEAD_RIGHT + 1, HEAD_TOP - 3, horn);
      // Horn bases (curving inward toward the cap)
      put(cells, HEAD_LEFT - 1, HEAD_TOP - 2, hornShade);
      put(cells, HEAD_LEFT, HEAD_TOP - 2, horn);
      put(cells, HEAD_RIGHT, HEAD_TOP - 2, horn);
      put(cells, HEAD_RIGHT + 1, HEAD_TOP - 2, hornShade);
      // Helmet cap top (2 rows over the head crown)
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) {
        put(cells, x, HEAD_TOP - 1, metal);
        put(cells, x, HEAD_TOP, metal);
      }
      // Side rim (full width)
      put(cells, HEAD_LEFT, HEAD_TOP, metal);
      put(cells, HEAD_RIGHT, HEAD_TOP, metal);
      // Nasal bar (vertical down between the eyes)
      put(cells, CX, HEAD_TOP + 1, metalDark);
      put(cells, CX, HEAD_TOP + 2, metalDark);
      put(cells, CX, HEAD_TOP + 3, metalDark);
      return;
    }
    case 'spartanhelmet': {
      // Corinthian helmet with red mohawk crest above + bronze cap with
      // cheek guards and a vertical nose bar. Eyes still visible.
      const bronze = '#C09040';
      const bronzeDark = '#7A6020';
      const crest = '#C13E3E';
      // Crest mohawk above the head (4 rows tall, 2 wide centered)
      for (let y = HEAD_TOP - 4; y <= HEAD_TOP - 1; y++) {
        put(cells, CX, y, crest);
        put(cells, CX + 1, y, crest);
      }
      // Helmet cap top + crown row
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, HEAD_TOP - 1, bronze);
        put(cells, x, HEAD_TOP, bronze);
      }
      // Re-paint crest on top so it sits ABOVE the cap rim
      for (let y = HEAD_TOP - 4; y <= HEAD_TOP - 2; y++) {
        put(cells, CX, y, crest);
        put(cells, CX + 1, y, crest);
      }
      // Cheek guards on both sides (2 rows below the cap)
      put(cells, HEAD_LEFT, HEAD_TOP + 1, bronze);
      put(cells, HEAD_LEFT, HEAD_TOP + 2, bronze);
      put(cells, HEAD_RIGHT, HEAD_TOP + 1, bronze);
      put(cells, HEAD_RIGHT, HEAD_TOP + 2, bronze);
      // Nose bar (vertical bronze strip down the centerline)
      put(cells, CX, HEAD_TOP + 1, bronzeDark);
      put(cells, CX, HEAD_TOP + 2, bronzeDark);
      put(cells, CX, HEAD_TOP + 3, bronzeDark);
      return;
    }
    case 'feather': {
      // Indian chief feather headband, band color now matches the feathers
      // (red shafts + white tips) per D's 2026-04-26 ask. Symmetric around CX.
      const band = '#C13E3E';        // red, matches feather shaft
      const bandDark = '#7A1818';    // deep red shadow on the edges
      const beadColor = '#FFD84A';   // yellow bead in the band center
      const featherR = '#C13E3E';
      const featherY = '#FFD84A';
      const featherTip = '#FFFFFF';
      // Band: 1 row across the forehead
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, HEAD_TOP, band);
      }
      // Band shadow at the edges for depth
      put(cells, HEAD_LEFT, HEAD_TOP, bandDark);
      put(cells, HEAD_RIGHT, HEAD_TOP, bandDark);
      // Bead in the center of the band
      put(cells, CX, HEAD_TOP, beadColor);
      // Center feather, 4 rows tall, white tip + alternating red/yellow body
      put(cells, CX, HEAD_TOP - 4, featherTip);
      put(cells, CX, HEAD_TOP - 3, featherR);
      put(cells, CX, HEAD_TOP - 2, featherY);
      put(cells, CX, HEAD_TOP - 1, featherR);
      // Left feather, 3 rows tall, white tip + red body
      put(cells, HEAD_LEFT + 1, HEAD_TOP - 3, featherTip);
      put(cells, HEAD_LEFT + 1, HEAD_TOP - 2, featherR);
      put(cells, HEAD_LEFT + 1, HEAD_TOP - 1, featherR);
      // Right feather, 3 rows tall, white tip + red body
      put(cells, HEAD_RIGHT - 1, HEAD_TOP - 3, featherTip);
      put(cells, HEAD_RIGHT - 1, HEAD_TOP - 2, featherR);
      put(cells, HEAD_RIGHT - 1, HEAD_TOP - 1, featherR);
      return;
    }
    case 'furhat': {
      // Mongol papakha, round fur cap with subtle fur-tuft texture.
      const c = f.hatColor;
      const dark = '#1A1010';
      // Top dome (narrowest, fur is rounded)
      for (let x = HEAD_LEFT + 2; x <= HEAD_RIGHT - 2; x++) {
        put(cells, x, HEAD_TOP - 3, c);
      }
      // Body (slightly wider)
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) {
        put(cells, x, HEAD_TOP - 2, c);
      }
      // Bottom band (full width, sits flat on the head)
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, HEAD_TOP - 1, c);
      }
      // Fur texture, a few darker tufts scattered (deterministic positions)
      put(cells, HEAD_LEFT + 2, HEAD_TOP - 2, dark);
      put(cells, HEAD_RIGHT - 2, HEAD_TOP - 3, dark);
      put(cells, HEAD_LEFT + 4, HEAD_TOP - 1, dark);
      put(cells, HEAD_RIGHT - 1, HEAD_TOP - 1, dark);
      return;
    }
  }
}

// ─── Body: torso + arms + legs + shoes ────────────────────────────────

function drawTorso(cells: Cell[], f: Features): void {
  const o = f.outfitPalette;
  for (let y = TORSO_TOP; y <= TORSO_BOTTOM; y++) {
    for (let x = TORSO_LEFT; x <= TORSO_RIGHT; x++) {
      put(cells, x, y, o.primary);
    }
  }
  // Bottom shade row for body depth
  for (let x = TORSO_LEFT; x <= TORSO_RIGHT; x++) {
    put(cells, x, TORSO_BOTTOM, o.shadow);
  }

  switch (f.outfit) {
    case 'tunic':
      // Belt / waistband
      for (let x = TORSO_LEFT; x <= TORSO_RIGHT; x++) {
        put(cells, x, BELT_Y, f.pants.shadow);
      }
      // Buckle
      put(cells, CX, BELT_Y, o.accent);
      put(cells, CX + 1, BELT_Y, o.accent);
      break;
    case 'tee':
      // Simple V-neck (2 pixels of skin showing)
      put(cells, CX, TORSO_TOP, f.skin.base);
      put(cells, CX + 1, TORSO_TOP, f.skin.base);
      put(cells, CX, TORSO_TOP + 1, f.skin.base);
      break;
    case 'striped': {
      // 3-4 clear white bands across torso, matching reference
      const stripeRows = [TORSO_TOP + 1, TORSO_TOP + 3, TORSO_TOP + 5, TORSO_TOP + 7];
      for (const sy of stripeRows) {
        if (sy > TORSO_BOTTOM - 1) continue;
        for (let x = TORSO_LEFT; x <= TORSO_RIGHT; x++) {
          put(cells, x, sy, '#FFFFFF');
        }
      }
      break;
    }
    case 'tank':
      // Expose upper chest as skin, thin straps
      for (let y = TORSO_TOP; y <= TORSO_TOP + 2; y++) {
        for (let x = TORSO_LEFT + 1; x <= TORSO_RIGHT - 1; x++) {
          put(cells, x, y, f.skin.base);
        }
      }
      // Straps
      for (let y = TORSO_TOP; y <= TORSO_TOP + 2; y++) {
        put(cells, TORSO_LEFT + 1, y, o.primary);
        put(cells, TORSO_RIGHT - 1, y, o.primary);
      }
      break;
    case 'suit': {
      // White shirt V centered
      for (let dx = -1; dx <= 0; dx++) {
        put(cells, CX + dx, TORSO_TOP, '#FFFFFF');
        put(cells, CX + dx, TORSO_TOP + 1, '#FFFFFF');
        put(cells, CX + dx, TORSO_TOP + 2, '#FFFFFF');
      }
      // Tie, accent color (red / gold)
      put(cells, CX, TORSO_TOP + 1, o.accent);
      put(cells, CX, TORSO_TOP + 2, o.accent);
      for (let y = TORSO_TOP + 3; y <= TORSO_BOTTOM - 2; y++) {
        put(cells, CX, y, o.accent);
        put(cells, CX + 1, y, o.accent);
      }
      // Lapels darker
      put(cells, CX - 2, TORSO_TOP, o.shadow);
      put(cells, CX + 2, TORSO_TOP, o.shadow);
      break;
    }
    case 'chainmail': {
      // Restrained chainmail, small dots at every 3rd cell only, on the
      // chest area only (not over the belt). Lighter pattern reads as
      // armor texture without devolving into a checker grid.
      for (let y = TORSO_TOP + 1; y <= TORSO_BOTTOM - 2; y += 2) {
        for (let x = TORSO_LEFT + 1; x <= TORSO_RIGHT - 1; x += 3) {
          put(cells, x, y, o.shadow);
        }
      }
      // Belt across the bottom for armor definition.
      for (let x = TORSO_LEFT; x <= TORSO_RIGHT; x++) {
        put(cells, x, TORSO_BOTTOM - 1, o.accent);
      }
      break;
    }
    case 'shirtless': {
      // Bare-chest boxer build, paint the upper torso in skin, mark
      // pectoral cleavage + side shading for muscle definition, then put
      // trunks across the bottom + a champion belt at the waist.
      const skin = f.skin.base;
      const shade = f.skin.shade;
      // Wipe torso to skin (overwrite the primary fill for chest area).
      for (let y = TORSO_TOP; y <= TORSO_BOTTOM - 3; y++) {
        for (let x = TORSO_LEFT; x <= TORSO_RIGHT; x++) {
          put(cells, x, y, skin);
        }
      }
      // Pectoral cleavage line down center (3 cells)
      put(cells, CX, TORSO_TOP + 2, shade);
      put(cells, CX + 1, TORSO_TOP + 2, shade);
      put(cells, CX, TORSO_TOP + 3, shade);
      put(cells, CX + 1, TORSO_TOP + 3, shade);
      // Side muscle shading
      for (let y = TORSO_TOP + 1; y <= TORSO_BOTTOM - 4; y++) {
        put(cells, TORSO_LEFT, y, shade);
        put(cells, TORSO_RIGHT, y, shade);
      }
      // Abs hint, two horizontal shade rows lower
      for (let x = TORSO_LEFT + 2; x <= TORSO_RIGHT - 2; x++) {
        put(cells, x, TORSO_BOTTOM - 4, shade);
      }
      // Trunks (last 2 rows of torso)
      for (let y = TORSO_BOTTOM - 2; y <= TORSO_BOTTOM; y++) {
        for (let x = TORSO_LEFT; x <= TORSO_RIGHT; x++) {
          put(cells, x, y, o.primary);
        }
      }
      // Champion belt, gold band with center buckle
      for (let x = TORSO_LEFT; x <= TORSO_RIGHT; x++) {
        put(cells, x, BELT_Y, '#FFD84A');
      }
      put(cells, CX, BELT_Y, '#A0700A');
      put(cells, CX + 1, BELT_Y, '#A0700A');
      break;
    }
    case 'tribal': {
      // Indian chief, bare chest with pec definition + 6-pack abs +
      // brown loincloth (no champion belt, no trunks).
      const skin = f.skin.base;
      const shade = f.skin.shade;
      // Wipe upper torso to skin (chest + abs zone).
      for (let y = TORSO_TOP; y <= TORSO_BOTTOM - 3; y++) {
        for (let x = TORSO_LEFT; x <= TORSO_RIGHT; x++) {
          put(cells, x, y, skin);
        }
      }
      // Pectoral cleavage, 2-col vertical line at center, top of chest
      put(cells, CX, TORSO_TOP + 1, shade);
      put(cells, CX + 1, TORSO_TOP + 1, shade);
      put(cells, CX, TORSO_TOP + 2, shade);
      put(cells, CX + 1, TORSO_TOP + 2, shade);
      // Side muscle shading along entire chest + ab area
      for (let y = TORSO_TOP + 1; y <= TORSO_BOTTOM - 3; y++) {
        put(cells, TORSO_LEFT, y, shade);
        put(cells, TORSO_RIGHT, y, shade);
      }
      // 6-pack: vertical center divider continues from pec line down,
      // plus 2 horizontal divider lines splitting the abs into 3 ab pairs.
      for (let y = TORSO_TOP + 3; y <= TORSO_BOTTOM - 3; y++) {
        put(cells, CX, y, shade);
        put(cells, CX + 1, y, shade);
      }
      // Horizontal ab dividers
      for (let x = TORSO_LEFT + 1; x <= TORSO_RIGHT - 1; x++) {
        put(cells, x, TORSO_TOP + 4, shade);
        put(cells, x, TORSO_TOP + 6, shade);
      }
      // Loincloth, brown wrap covering the bottom (replaces trunks)
      for (let y = TORSO_BOTTOM - 2; y <= TORSO_BOTTOM; y++) {
        for (let x = TORSO_LEFT; x <= TORSO_RIGHT; x++) {
          put(cells, x, y, o.primary);
        }
      }
      // Tied cord at the waist (in shadow color, with accent center knot)
      for (let x = TORSO_LEFT; x <= TORSO_RIGHT; x++) {
        put(cells, x, BELT_Y, o.shadow);
      }
      put(cells, CX, BELT_Y, o.accent);
      put(cells, CX + 1, BELT_Y, o.accent);
      break;
    }
  }
}

function drawArms(cells: Cell[], f: Features): void {
  const o = f.outfitPalette;
  const skin = f.skin.base;
  const shade = f.skin.shade;

  // Right arm (viewer's left), RAISED, bent. Shoulder (7,13), upper arm up
  // along cols 6-7 rows 11-12, forearm up-left cols 5-6 rows 9-10, fist at (5,9).
  put(cells, 6, 12, o.primary); // shoulder joint
  put(cells, 7, 12, o.shadow);
  put(cells, 6, 11, o.primary); // bicep
  put(cells, 7, 11, o.shadow);
  put(cells, 5, 10, o.primary); // forearm
  put(cells, 6, 10, o.shadow);
  // Hand (skin)
  put(cells, 5, 9, skin);
  put(cells, 6, 9, shade);

  // Left arm (viewer's right), LOWERED, slight bend.
  // Shoulder (16, 13), upper arm (17, 14-15), forearm (17-18, 16-17), hand at (18, 18).
  put(cells, 17, 14, o.primary);
  put(cells, 17, 15, o.primary);
  put(cells, 17, 16, o.shadow);
  put(cells, 18, 17, o.primary);
  if (f.hook) {
    // Pirate hook, silver J-shape that extends down + curves outward, so
    // the "hook" silhouette reads at a glance instead of looking like a
    // 2x2 silver stub. Wrist attaches at (17,18); shaft drops two rows;
    // claw curls back up to the right.
    const silver = '#D4D4D4';
    const dark = '#5A5A5A';
    put(cells, 17, 18, silver); // wrist cap
    put(cells, 18, 18, silver); // wrist edge
    put(cells, 18, 19, silver); // shaft going down
    put(cells, 18, 20, silver); // shaft tip
    put(cells, 19, 20, silver); // hook claw curling outward
    put(cells, 19, 19, dark);   // negative space inside the hook curl
  } else if (f.glove) {
    // Boxer's left-hand boxing glove, 2×2 red mitt above a 2-pixel white
    // wrist cuff. Replaces the skin hand entirely. Per D's 2026-04-27.
    const red = '#D80000';
    const white = '#FFFFFF';
    put(cells, 17, 17, red);   // mitt top-left
    put(cells, 18, 17, red);   // mitt top-right
    put(cells, 17, 18, red);   // mitt bottom-left
    put(cells, 18, 18, red);   // mitt bottom-right
    put(cells, 17, 19, white); // cuff left
    put(cells, 18, 19, white); // cuff right
  } else {
    // Skin hand
    put(cells, 18, 18, skin);
    put(cells, 17, 18, shade);
  }
}

function drawLegs(cells: Cell[], f: Features): void {
  const p = f.pants;
  const line = f.skin.line;

  // Leg filling
  for (let y = LEG_TOP; y <= LEG_BOTTOM; y++) {
    put(cells, LEG_LEFT_A, y, p.primary);
    put(cells, LEG_LEFT_B, y, p.shadow);
    put(cells, LEG_RIGHT_A, y, p.primary);
    put(cells, LEG_RIGHT_B, y, p.shadow);
  }
  // Outlines around legs
  for (let y = LEG_TOP; y <= LEG_BOTTOM; y++) {
    put(cells, LEG_LEFT_A - 1, y, line);
    put(cells, LEG_LEFT_B + 1, y, line);
    put(cells, LEG_RIGHT_A - 1, y, line);
    put(cells, LEG_RIGHT_B + 1, y, line);
  }

  // Shoes, 3 wide, 2 tall, flat, slightly wider than legs.
  const s = f.shoeColor;
  for (let dx = -1; dx <= 1; dx++) {
    put(cells, LEG_LEFT_A + dx, SHOE_Y, s);
    put(cells, LEG_LEFT_A + dx, SHOE_Y + 1, s);
  }
  for (let dx = -1; dx <= 1; dx++) {
    put(cells, LEG_RIGHT_A + dx, SHOE_Y, s);
    put(cells, LEG_RIGHT_A + dx, SHOE_Y + 1, s);
  }
}

// ─── Accessories + marks + species overlays ────────────────────────────

function drawAccessory(cells: Cell[], f: Features): void {
  const eyeY = HEAD_TOP + 4;
  switch (f.accessory) {
    case 'none':
      return;
    case 'eyepatch':
      // Covers left eye + diagonal strap
      put(cells, HEAD_LEFT + 1, eyeY, '#1A1A1A');
      put(cells, HEAD_LEFT + 2, eyeY, '#1A1A1A');
      put(cells, HEAD_LEFT + 3, eyeY, '#1A1A1A');
      put(cells, HEAD_LEFT, eyeY - 1, '#1A1A1A');
      put(cells, HEAD_LEFT + 4, eyeY - 1, '#1A1A1A');
      return;
    case 'earring':
      put(cells, HEAD_LEFT - 1, eyeY + 2, '#FFD84A');
      return;
    case 'necklace':
      for (let dx = -2; dx <= 2; dx++) put(cells, CX + dx, TORSO_TOP - 1, '#FFD84A');
      put(cells, CX, TORSO_TOP, '#C13E3E');
      return;
    case 'cigar':
      put(cells, CX + 2, HEAD_TOP + 6, '#3A2610');
      put(cells, CX + 3, HEAD_TOP + 6, '#3A2610');
      put(cells, CX + 4, HEAD_TOP + 6, '#FF6A1A');
      put(cells, CX + 5, HEAD_TOP + 5, '#C0C0C0');
      return;
    case 'glasses':
      // Round frames over both eyes
      const lx = HEAD_LEFT + 2;
      const rx = HEAD_RIGHT - 3;
      put(cells, lx - 1, eyeY, '#1A1A1A');
      put(cells, lx + 1, eyeY, '#1A1A1A');
      put(cells, lx, eyeY - 1, '#1A1A1A');
      put(cells, lx, eyeY + 1, '#1A1A1A');
      put(cells, rx - 1, eyeY, '#1A1A1A');
      put(cells, rx + 1, eyeY, '#1A1A1A');
      put(cells, rx, eyeY - 1, '#1A1A1A');
      put(cells, rx, eyeY + 1, '#1A1A1A');
      // Bridge
      put(cells, lx + 2, eyeY, '#1A1A1A');
      return;
  }
}

function drawFaceMark(cells: Cell[], f: Features): void {
  const line = f.skin.line;
  const eyeY = HEAD_TOP + 4;
  switch (f.faceMark) {
    case 'none':
      return;
    case 'scar':
      put(cells, HEAD_RIGHT - 2, HEAD_TOP + 2, '#FFFFFF');
      put(cells, HEAD_RIGHT - 2, HEAD_TOP + 3, '#FFFFFF');
      put(cells, HEAD_RIGHT - 2, HEAD_TOP + 4, '#FFFFFF');
      return;
    case 'freckles':
      put(cells, CX - 1, eyeY + 1, line);
      put(cells, CX + 1, eyeY + 1, line);
      put(cells, CX + 2, eyeY, line);
      return;
    case 'warpaint': {
      // Vertical red cheek stripes, berserker face. Both stripes pinned
      // to the head edges (cols 8 + 15) per D's 2026-04-26 follow-up, so
      // the left stripe stops clipping into the left sclera at col 9.
      const c = '#C13E3E';
      for (let y = HEAD_TOP + 3; y <= HEAD_TOP + 5; y++) {
        put(cells, HEAD_LEFT, y, c);   // col 8, head's left edge
        put(cells, HEAD_RIGHT, y, c);  // col 15, head's right edge
      }
      return;
    }
    case 'bandage':
      for (let x = HEAD_LEFT + 1; x <= HEAD_RIGHT - 1; x++) {
        put(cells, x, HEAD_TOP + 1, '#FFFFFF');
      }
      put(cells, CX, HEAD_TOP + 2, '#C13E3E');
      return;
    case 'mask': {
      // Ninja mask, solid black bar across the eye row with white slits
      // exactly where the pupils sit. Drawn AFTER the face so it paints
      // over the pupils cleanly. Trim ends by one col so the mask reads
      // as a wrap instead of spilling past the head corners.
      const maskY = eyeY;
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, maskY, '#0A0A0A');
        put(cells, x, maskY + 1, '#0A0A0A');
      }
      // Eye slits, white dots right where the pupils would be.
      put(cells, HEAD_LEFT + 2, maskY, '#FFFFFF');
      put(cells, HEAD_RIGHT - 3, maskY, '#FFFFFF');
      return;
    }
  }
}

function drawSpeciesExtras(cells: Cell[], f: Features): void {
  const mouthY = HEAD_TOP + 6;
  switch (f.species) {
    case 'normal':
      return;
    case 'vampire':
      put(cells, CX - 1, mouthY + 1, '#FFFFFF');
      put(cells, CX + 1, mouthY + 1, '#FFFFFF');
      return;
    case 'zombie':
      // Stitches across mouth
      for (let dx = -2; dx <= 2; dx++) {
        if (dx % 2 === 0) put(cells, CX + dx, mouthY + 1, f.skin.line);
      }
      return;
    case 'ghost':
      for (let y = SHOE_Y; y < H; y++) {
        for (let x = LEG_LEFT_A - 1; x <= LEG_RIGHT_B + 1; x++) {
          if ((x + y) % 2 === 0) put(cells, x, y, '#C0D0E8');
        }
      }
      return;
    case 'robot':
      // Antenna
      put(cells, CX, HEAD_TOP - 3, '#E0E0E0');
      put(cells, CX, HEAD_TOP - 4, '#FFD84A');
      // Red glowing right eye
      put(cells, HEAD_RIGHT - 3, HEAD_TOP + 4, '#FF1A1A');
      put(cells, HEAD_RIGHT - 2, HEAD_TOP + 4, '#FF1A1A');
      return;
  }
}

// ─── Weapons, held in the RAISED right hand near head level ───────────
// Anchor is R_HAND = (5, 9). `grip` is the pixel in the sprite that lines
// up with the brawler's fist. Tip extends upward from there.

interface WeaponSprite {
  sprite: readonly string[];
  palette: Record<string, string>;
  grip: { x: number; y: number };
}

// Weapons redesigned 2026-04-26 v2, even taller, held above the head.
// Most melee blades now span 9-10 rows (hand at row 9 up to row 0/1, the
// top of the cell). Inspired by Fantums art: dramatic silhouettes that
// dominate the right edge of the cell.
//
// Palette keys: s=silver blade, S=white highlight, g=gold accent,
// h=brown handle, m=metal dark, M=metal mid, b=bat brown, B=bat shadow,
// f=flame orange, F=flame yellow, e=cyan core, E=cyan highlight,
// r=red metal, R=red shadow
const WEAPONS: Record<string, WeaponSprite> = {
  knife: {
    // Long dagger, 10 rows tall, pointed white tip, gold cross-guard.
    sprite: [
      '.S.',
      '.S.',
      '.s.',
      '.s.',
      '.s.',
      '.s.',
      '.s.',
      '.s.',
      'gSg',
      '.h.',
    ],
    palette: { s: '#E0E0E0', S: '#FFFFFF', g: '#FFD84A', h: '#5A3A1A' },
    grip: { x: 1, y: 9 },
  },
  'baseball bat': {
    // Tall tapered bat, fat at the top, narrower at the handle.
    sprite: [
      'bb',
      'bb',
      'bb',
      'bB',
      'bB',
      'bB',
      'bB',
      'bB',
      'hh',
      'hh',
    ],
    palette: { b: '#C48A48', B: '#8A5A28', h: '#3A2610' },
    grip: { x: 0, y: 9 },
  },
  crowbar: {
    // 9-row J-hook with a wider hook claw at the top and splayed foot bottom.
    sprite: [
      'rrr',
      'r.r',
      'rr.',
      '..r',
      '..r',
      '..r',
      '..r',
      '..r',
      'rrr',
    ],
    palette: { r: '#C13E3E', R: '#7A1818' },
    grip: { x: 1, y: 8 },
  },
  machete: {
    // 9-row wide cleaver blade, sweep at the top, full width down to hilt.
    sprite: [
      '.ss',
      'sss',
      'sSs',
      'sss',
      'sss',
      'sss',
      'sss',
      'gsg',
      '.h.',
    ],
    palette: { s: '#E0E0E0', S: '#FFFFFF', g: '#FFD84A', h: '#5A3A1A' },
    grip: { x: 1, y: 8 },
  },
  pistol: {
    // Compact pistol, barrel, slide, grip.
    sprite: [
      'mmmm',
      'MMMm',
      '...m',
      '..hh',
      '..h.',
    ],
    palette: { m: '#1A1A1A', M: '#7A7A7A', h: '#5A3A1A' },
    grip: { x: 2, y: 4 },
  },
  shotgun: {
    // Long barrel with stock + grip.
    sprite: [
      'mmmmm',
      'mMMMm',
      'mmmmm',
      '....m',
      '...hh',
      '...h.',
    ],
    palette: { m: '#1A1A1A', M: '#7A7A7A', h: '#5A3A1A' },
    grip: { x: 3, y: 5 },
  },
  sledgehammer: {
    // 9-row hammer, 4-wide head + clear shaft + handle.
    sprite: [
      'mMMm',
      'MMMM',
      'MMMM',
      'mMMm',
      '.ss.',
      '.ss.',
      '.ss.',
      '.ss.',
      '.hh.',
    ],
    palette: { m: '#5A5A5A', M: '#A0A0A0', s: '#5A3A1A', h: '#3A2610' },
    grip: { x: 1, y: 8 },
  },
  'flaming sword': {
    // 10-row blade, flame tower 3 rows tall on top.
    sprite: [
      '.f.',
      'fFf',
      'fFf',
      '.s.',
      '.S.',
      '.s.',
      '.s.',
      '.s.',
      'gSg',
      '.h.',
    ],
    palette: { f: '#FF6A1A', F: '#FFD84A', s: '#E0E0E0', S: '#FFFFFF', g: '#FFD84A', h: '#5A3A1A' },
    grip: { x: 1, y: 9 },
  },
  'electric axe': {
    // 9-row axe with chunky 3-row cyan head.
    sprite: [
      'EEE',
      'EEE',
      'EeE',
      '.s.',
      '.s.',
      '.s.',
      '.s.',
      'gsg',
      '.h.',
    ],
    palette: { e: '#6AE0FF', E: '#D0F4FF', s: '#5A3A1A', g: '#FFD84A', h: '#3A2610' },
    grip: { x: 1, y: 8 },
  },
  bazooka: {
    // Long tube with wider muzzle + sight + grip.
    sprite: [
      '..M...',
      'mmmmmm',
      'mMMMMm',
      'mmmmmm',
      '....h.',
      '...hh.',
    ],
    palette: { m: '#1A1A1A', M: '#A0A0A0', h: '#5A3A1A' },
    grip: { x: 4, y: 5 },
  },
  'rail gun': {
    // Sci-fi rifle with cyan core.
    sprite: [
      '..M...',
      'mmmmmm',
      'mMeeMm',
      'mMEEMm',
      'mmmmmm',
      '....h.',
      '...hh.',
    ],
    palette: { m: '#1A1A1A', M: '#A0A0A0', e: '#6AE0FF', E: '#D0F4FF', h: '#5A3A1A' },
    grip: { x: 4, y: 6 },
  },
  kingsblade: {
    // 10-row regal blade, bumped to 5-wide for the king-only "huge weapon"
    // ask. Wider blade with double highlight rails, gold cross-guard with
    // ruby pommel finial. Grip stays centered so it lines up with R_HAND.
    sprite: [
      '..S..',
      '.SsS.',
      '.SsS.',
      '.SsS.',
      '.SsS.',
      '.SsS.',
      '.SsS.',
      'gSsSg',
      '.gsg.',
      '..h..',
    ],
    palette: { s: '#FFF4A8', S: '#FFFFFF', g: '#FFD84A', h: '#6A1818' },
    grip: { x: 2, y: 9 },
  },
};

function resolveWeapon(name: string): WeaponSprite {
  const k = name.toLowerCase().trim();
  if (WEAPONS[k]) return WEAPONS[k]!;
  if (k.includes('sword') || k.includes('blade') || k.includes('saber') || k.includes('katana'))
    return WEAPONS['machete']!;
  if (k.includes('axe') || k.includes('hatchet')) return WEAPONS['electric axe']!;
  if (k.includes('hammer') || k.includes('mace')) return WEAPONS['sledgehammer']!;
  if (k.includes('bow') || k.includes('cross')) return WEAPONS['knife']!;
  if (k.includes('rifle') || k.includes('sniper')) return WEAPONS['shotgun']!;
  if (k.includes('bat') || k.includes('club') || k.includes('staff')) return WEAPONS['baseball bat']!;
  if (k.includes('gun') || k.includes('pistol')) return WEAPONS['pistol']!;
  return WEAPONS['knife']!;
}

function drawWeapon(cells: Cell[], weaponName: string): void {
  const w = resolveWeapon(weaponName);
  const x0 = R_HAND.x - w.grip.x;
  const y0 = R_HAND.y - w.grip.y;
  for (let dy = 0; dy < w.sprite.length; dy++) {
    const row = w.sprite[dy]!;
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx]!;
      if (ch === ' ') continue;
      const color = w.palette[ch];
      if (!color) continue;
      put(cells, x0 + dx, y0 + dy, color);
    }
  }
}

// ─── Off-hand items, held in the left hand at waist level ────────────

function drawOffHand(cells: Cell[], f: Features): void {
  if (f.offHand === 'none') return;
  const { x, y } = L_HAND;
  switch (f.offHand) {
    case 'bottle':
      put(cells, x, y - 3, '#1A3A1A');
      put(cells, x, y - 2, '#2A6A2A');
      put(cells, x, y - 1, '#2A6A2A');
      put(cells, x, y, '#F4E0A8');
      put(cells, x + 1, y - 1, '#1A3A1A');
      return;
    case 'torch':
      put(cells, x, y - 4, '#FF6A1A');
      put(cells, x + 1, y - 4, '#FFD84A');
      put(cells, x, y - 3, '#FFD84A');
      put(cells, x, y - 2, '#5A3A1A');
      put(cells, x, y - 1, '#5A3A1A');
      return;
    case 'lantern':
      put(cells, x, y - 4, '#1A1A1A');
      put(cells, x + 1, y - 4, '#1A1A1A');
      put(cells, x, y - 3, '#FFD84A');
      put(cells, x + 1, y - 3, '#FFD84A');
      put(cells, x, y - 2, '#1A1A1A');
      put(cells, x + 1, y - 2, '#1A1A1A');
      return;
    case 'coinbag':
      put(cells, x, y - 2, '#FFD84A');
      put(cells, x + 1, y - 2, '#6A4A2A');
      put(cells, x, y - 1, '#6A4A2A');
      put(cells, x + 1, y - 1, '#6A4A2A');
      return;
    case 'chalice':
      put(cells, x, y - 3, '#FFD84A');
      put(cells, x + 1, y - 3, '#C13E3E');
      put(cells, x, y - 2, '#FFD84A');
      put(cells, x + 1, y - 2, '#FFD84A');
      put(cells, x, y - 1, '#FFD84A');
      return;
    case 'book':
      put(cells, x, y - 2, '#2A1A5A');
      put(cells, x + 1, y - 2, '#4A2A7A');
      put(cells, x, y - 1, '#2A1A5A');
      put(cells, x + 1, y - 1, '#4A2A7A');
      return;
    case 'staff':
      // Tall wooden staff with a cyan gem on top
      for (let dy = -10; dy <= 2; dy++) put(cells, x, y + dy, '#5A3A1A');
      put(cells, x, y - 11, '#6AE0FF');
      put(cells, x - 1, y - 11, '#6AE0FF');
      put(cells, x + 1, y - 11, '#6AE0FF');
      return;
  }
}

// ─── Scenes / aura / spark ─────────────────────────────────────────────

// Bright "+" cross, 5 pixels (top, left, center, right, bottom). Used as
// the rarity-tier accent on the upgraded backgrounds (rare → king).
function drawPlus(cells: Cell[], cx: number, cy: number, color: string): void {
  put(cells, cx, cy - 1, color);
  put(cells, cx - 1, cy, color);
  put(cells, cx, cy, color);
  put(cells, cx + 1, cy, color);
  put(cells, cx, cy + 1, color);
}

function drawScene(cells: Cell[], scene: Scene): void {
  switch (scene) {
    case 'none':
      return;
    case 'diamondblue': {
      // King, diamond blue facet base + 4 yellow corner crosses + 2
      // bright orange mid-side crosses (the orange anchors the regal
      // pop above all other tiers).
      const base = '#3FA5E0';
      const mid = '#6FCFFF';
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          put(cells, x, y, ((x + y) & 3) === 0 ? mid : base);
        }
      }
      drawPlus(cells, 2, 2, '#FFD84A');
      drawPlus(cells, 21, 2, '#FFD84A');
      drawPlus(cells, 2, 28, '#FFD84A');
      drawPlus(cells, 21, 28, '#FFD84A');
      drawPlus(cells, 2, 15, '#FF6A1A');
      drawPlus(cells, 21, 15, '#FF6A1A');
      return;
    }
    case 'commonbg': {
      // Common, solid muted slate. No facets, no sparkles. Plainest tier.
      const base = '#3A3A45';
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          put(cells, x, y, base);
        }
      }
      return;
    }
    case 'uncommonbg': {
      // Uncommon, solid forest green with 2 small white sparkles in the
      // opposite corners. First hint of "bling".
      const base = '#1A6A3A';
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          put(cells, x, y, base);
        }
      }
      put(cells, 2, 2, '#FFFFFF');
      put(cells, 21, 28, '#FFFFFF');
      return;
    }
    case 'rarebg': {
      // Rare, blue with a light facet pattern + 2 yellow crosses
      // (top-right + bottom-left corners only).
      const base = '#3A5AAA';
      const mid = '#5A7ACA';
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          put(cells, x, y, ((x + y) % 6 === 0) ? mid : base);
        }
      }
      drawPlus(cells, 21, 2, '#FFD84A');   // top-right
      drawPlus(cells, 2, 28, '#FFD84A');   // bottom-left
      return;
    }
    case 'legendarybg': {
      // Legendary, royal purple with denser facets + 4 yellow crosses
      // (one in each corner).
      const base = '#5A2A9A';
      const mid = '#8A4ACA';
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          put(cells, x, y, ((x + y) % 4 === 0) ? mid : base);
        }
      }
      drawPlus(cells, 2, 2, '#FFD84A');
      drawPlus(cells, 21, 2, '#FFD84A');
      drawPlus(cells, 2, 28, '#FFD84A');
      drawPlus(cells, 21, 28, '#FFD84A');
      return;
    }
    case 'epicbg': {
      // Epic, radiant orange/gold with dense facet pattern + 6 yellow
      // crosses (4 corners + 2 mid-sides). One step under king in pop.
      const base = '#B85A1A';
      const mid = '#E08A2A';
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          put(cells, x, y, ((x + y) & 3) === 0 ? mid : base);
        }
      }
      drawPlus(cells, 2, 2, '#FFD84A');
      drawPlus(cells, 21, 2, '#FFD84A');
      drawPlus(cells, 2, 28, '#FFD84A');
      drawPlus(cells, 21, 28, '#FFD84A');
      drawPlus(cells, 2, 15, '#FFD84A');
      drawPlus(cells, 21, 15, '#FFD84A');
      return;
    }
    case 'stars': {
      const positions: Array<[number, number]> = [
        [2, 1], [5, 3], [19, 2], [22, 4], [1, 6], [22, 7], [3, 10],
      ];
      for (const [x, y] of positions) {
        put(cells, x, y, '#FFFFFF');
        put(cells, x - 1, y, '#D0D8E0');
        put(cells, x + 1, y, '#D0D8E0');
        put(cells, x, y - 1, '#D0D8E0');
        put(cells, x, y + 1, '#D0D8E0');
      }
      return;
    }
    case 'moon': {
      const col = '#E0E4E8';
      for (let y = 1; y <= 5; y++) {
        for (let x = 17; x <= 21; x++) put(cells, x, y, col);
      }
      put(cells, 17, 1, '#1A1A1A');
      put(cells, 21, 1, '#1A1A1A');
      put(cells, 17, 5, '#1A1A1A');
      put(cells, 21, 5, '#1A1A1A');
      put(cells, 19, 3, '#A8AEB8');
      return;
    }
    case 'sun': {
      const col = '#FFD84A';
      for (let y = 1; y <= 4; y++) {
        for (let x = 1; x <= 4; x++) put(cells, x, y, col);
      }
      put(cells, 0, 1, '#FFA040');
      put(cells, 0, 4, '#FFA040');
      put(cells, 1, 0, '#FFA040');
      put(cells, 4, 0, '#FFA040');
      put(cells, 6, 2, '#FFA040');
      return;
    }
    case 'curtains': {
      const col = '#8A1A1A';
      for (let y = 0; y < 26; y++) {
        put(cells, 0, y, col);
        put(cells, 1, y, '#4A0808');
        put(cells, W - 2, y, '#4A0808');
        put(cells, W - 1, y, col);
      }
      for (let x = 0; x < W; x++) put(cells, x, 0, col);
      return;
    }
    case 'clouds': {
      const col = '#E0E8F0';
      for (let dx = 0; dx < 4; dx++) put(cells, 1 + dx, 2, col);
      for (let dx = 0; dx < 4; dx++) put(cells, 1 + dx, 3, col);
      for (let dx = 0; dx < 4; dx++) put(cells, 19 + dx, 1, col);
      for (let dx = 0; dx < 5; dx++) put(cells, 18 + dx, 2, col);
      return;
    }
    case 'rain': {
      const col = '#6AE0FF';
      const dark = '#2A80C8';
      const drops: Array<[number, number]> = [
        [2, 1], [6, 3], [11, 2], [15, 4], [19, 1], [22, 4],
        [4, 7], [9, 9], [14, 8], [18, 10], [3, 13],
      ];
      for (const [x, y] of drops) {
        put(cells, x, y, col);
        put(cells, x, y + 1, dark);
      }
      return;
    }
    case 'city': {
      const col = '#0A0A12';
      const skyline: Array<[number, number, number]> = [
        [0, 16, 3], [3, 13, 2], [5, 17, 2], [7, 14, 3], [10, 18, 2], [12, 15, 2],
        [14, 17, 2], [16, 14, 2], [18, 16, 2], [21, 13, 2],
      ];
      for (const [x, startY, width] of skyline) {
        for (let dx = 0; dx < width; dx++) {
          for (let y = startY; y < 24; y++) put(cells, x + dx, y, col);
        }
      }
      return;
    }
    case 'lightning': {
      const col = '#FFD84A';
      const positions: Array<[number, number]> = [
        [1, 1], [2, 3], [1, 5], [2, 7], [1, 9],
        [W - 2, 1], [W - 1, 3], [W - 2, 5], [W - 1, 7], [W - 2, 9],
      ];
      for (const [x, y] of positions) {
        put(cells, x, y, col);
        put(cells, x, y + 1, col);
      }
      return;
    }
    case 'sunset': {
      const bands: Array<[number, string]> = [
        [8, '#FFD84A'],
        [9, '#FFA040'],
        [10, '#FF6A5A'],
        [11, '#E8487A'],
      ];
      for (const [y, colour] of bands) {
        for (let x = 0; x < W; x++) put(cells, x, y, colour);
      }
      return;
    }
  }
}

function drawAura(cells: Cell[], aura: Aura): void {
  switch (aura) {
    case 'none':
      return;
    case 'halo':
      for (let x = HEAD_LEFT; x <= HEAD_RIGHT; x++) {
        put(cells, x, HEAD_TOP - 3, '#FFD84A');
      }
      put(cells, HEAD_LEFT - 1, HEAD_TOP - 2, '#FFD84A');
      put(cells, HEAD_RIGHT + 1, HEAD_TOP - 2, '#FFD84A');
      return;
    case 'spark':
      put(cells, HEAD_LEFT - 1, HEAD_TOP - 1, '#FFD84A');
      put(cells, HEAD_RIGHT + 1, HEAD_TOP - 1, '#FFD84A');
      put(cells, CX, HEAD_TOP - 2, '#FFD84A');
      put(cells, CX + 1, HEAD_TOP - 2, '#FFD84A');
      return;
    case 'fire':
      for (let i = 0; i < 6; i++) {
        put(cells, HEAD_LEFT + i, HEAD_TOP - 2, i % 2 === 0 ? '#FFD84A' : '#FF6A1A');
        put(cells, HEAD_LEFT + i, HEAD_TOP - 3, '#FF6A1A');
      }
      return;
  }
}

// ─── Bling (rare+ kit) ─────────────────────────────────────────────────
//
// Tiers:
//   1 (rare):       small chest gem
//   2 (legendary):  chest gem + 4 corner sparkles
//   3 (epic/king):  chest gem + sparkles + glittery shirt dots

function drawBling(cells: Cell[], f: Features): void {
  const lvl = f.blingLevel;
  if (lvl === 0) return;

  // ── Chest gem, 5-pixel cross of cyan/white centered on the chest.
  // Sits high enough to clear the belt area on every outfit.
  const gemCx = CX;
  const gemCy = TORSO_TOP + 3;
  put(cells, gemCx, gemCy, '#6AE0FF');         // gem core
  put(cells, gemCx, gemCy - 1, '#FFFFFF');      // sparkle up
  put(cells, gemCx, gemCy + 1, '#FFFFFF');      // sparkle down
  put(cells, gemCx - 1, gemCy, '#FFFFFF');      // sparkle left
  put(cells, gemCx + 1, gemCy, '#FFFFFF');      // sparkle right

  // ── Corner sparkles (legendary+), 4 small star-bursts in the corners
  // away from the body silhouette.
  if (lvl >= 2) {
    const corners: Array<[number, number]> = [
      [2, 2],
      [W - 3, 2],
      [2, H - 3],
      [W - 3, H - 3],
    ];
    for (const [x, y] of corners) {
      put(cells, x, y, '#FFFFFF');
      put(cells, x - 1, y, '#FFD84A');
      put(cells, x + 1, y, '#FFD84A');
      put(cells, x, y - 1, '#FFD84A');
      put(cells, x, y + 1, '#FFD84A');
    }
  }

  // ── Glittery shirt (epic + king), scattered bright dots on the torso
  // in a fixed pattern derived from the gem position. Avoids overdrawing
  // the gem itself.
  if (lvl >= 3) {
    const dots: Array<[number, number, string]> = [
      [TORSO_LEFT + 1, TORSO_TOP + 1, '#FFFFFF'],
      [TORSO_RIGHT - 1, TORSO_TOP + 1, '#FFD84A'],
      [TORSO_LEFT + 2, TORSO_TOP + 5, '#6AE0FF'],
      [TORSO_RIGHT - 2, TORSO_TOP + 5, '#FFFFFF'],
      [TORSO_LEFT + 1, TORSO_TOP + 7, '#FFD84A'],
      [TORSO_RIGHT - 1, TORSO_TOP + 7, '#6AE0FF'],
      [CX - 2, TORSO_TOP + 6, '#FFFFFF'],
      [CX + 2, TORSO_TOP + 6, '#FFD84A'],
    ];
    for (const [x, y, color] of dots) {
      put(cells, x, y, color);
    }
  }
}

// ─── Pet companion (rare+ only) ────────────────────────────────────────
//
// Sits to the right of the brawler at floor level. 5 wide × 3 tall sprite.
// Anchored at (px, py) = bottom-left of the sprite. Default position is
// next to the right shoe. Doesn't overlap the brawler's body.

function drawPet(cells: Cell[], pet: Pet, _blingLevel: number): void {
  if (pet === 'none') return;

  // Detailed pets 2026-04-26 v2, 6w × 6h, side-profile sitting position
  // modeled on the Fantums-style dog reference. Eyes, muzzle, legs, tail
  // markings all visible. Sits at the brawler's feet on the right.
  const px = 16;
  const py = 25;

  if (pet === 'dog') {
    // Black-and-white sitting dog (Boston-terrier vibe).
    const black = '#1A1A1A';
    const white = '#F0F0F0';
    const dark = '#3A2A1A';
    const eye = '#FFD84A';     // bright eye on the dark face so it reads
    // Row 0, pointy ears
    put(cells, px + 1, py, black);
    put(cells, px + 3, py, black);
    // Row 1, top of head
    put(cells, px + 1, py + 1, black);
    put(cells, px + 2, py + 1, black);
    put(cells, px + 3, py + 1, black);
    put(cells, px + 4, py + 1, black);
    // Row 2, face: eye + cheek
    put(cells, px + 1, py + 2, black);
    put(cells, px + 2, py + 2, eye);   // bright eye
    put(cells, px + 3, py + 2, black);
    put(cells, px + 4, py + 2, black);
    // Row 3, muzzle (white) + back
    put(cells, px, py + 3, white);     // muzzle nose tip
    put(cells, px + 1, py + 3, white);
    put(cells, px + 2, py + 3, black);
    put(cells, px + 3, py + 3, black);
    put(cells, px + 4, py + 3, black);
    put(cells, px + 5, py + 3, black); // back
    // Row 4, chest white + body + tail nub
    put(cells, px + 1, py + 4, white);
    put(cells, px + 2, py + 4, white);
    put(cells, px + 3, py + 4, black);
    put(cells, px + 4, py + 4, black);
    put(cells, px + 5, py + 4, black); // tail
    // Row 5, 4 legs visible
    put(cells, px + 1, py + 5, dark);
    put(cells, px + 2, py + 5, dark);
    put(cells, px + 4, py + 5, dark);
    put(cells, px + 5, py + 5, dark);
    return;
  }

  if (pet === 'cat') {
    // Grey sitting cat with pink nose, white chest patch, curled tail.
    const body = '#A8A8A8';
    const dark = '#5A5A5A';
    const white = '#F0F0F0';
    const pink = '#FF8AC0';
    const eye = '#FFD84A';
    // Row 0, very pointed ears (apart)
    put(cells, px, py, body);
    put(cells, px + 1, py, body);
    put(cells, px + 3, py, body);
    put(cells, px + 4, py, body);
    // Row 1, top of head
    put(cells, px, py + 1, body);
    put(cells, px + 1, py + 1, body);
    put(cells, px + 2, py + 1, body);
    put(cells, px + 3, py + 1, body);
    put(cells, px + 4, py + 1, body);
    // Row 2, face: eyes + nose
    put(cells, px, py + 2, body);
    put(cells, px + 1, py + 2, eye);    // left eye
    put(cells, px + 2, py + 2, pink);   // pink nose
    put(cells, px + 3, py + 2, eye);    // right eye
    put(cells, px + 4, py + 2, body);
    // Row 3, chin/muzzle + back + tail rising
    put(cells, px, py + 3, body);
    put(cells, px + 1, py + 3, white);  // white muzzle
    put(cells, px + 2, py + 3, white);
    put(cells, px + 3, py + 3, body);
    put(cells, px + 4, py + 3, body);
    put(cells, px + 5, py + 3, body);   // tail starts
    // Row 4, chest + body + tail curling
    put(cells, px, py + 4, body);
    put(cells, px + 1, py + 4, white);  // white chest
    put(cells, px + 2, py + 4, body);
    put(cells, px + 3, py + 4, body);
    put(cells, px + 4, py + 4, body);
    put(cells, px + 5, py + 4, body);   // tail curling up-right
    // Row 5, 4 legs visible + tail tip
    put(cells, px, py + 5, dark);
    put(cells, px + 1, py + 5, dark);
    put(cells, px + 3, py + 5, dark);
    put(cells, px + 4, py + 5, dark);
    return;
  }
}

// ─── Silhouette outline ──────────────────────────────────────────────
//
// Walks the cell map and paints a 1-pixel dark outline around every
// body/clothing/hair pixel that borders empty space. Gives the fighter
// a clean, readable silhouette against any background, the reference
// art has this crisp edge.

function addSilhouetteOutline(cells: Cell[], f: Features): void {
  const outline = f.skin.line;
  // Build an occupancy grid from current cells (later writes win, so use
  // a map just like compact() does).
  const occupied = new Set<string>();
  for (const c of cells) occupied.add(`${c.x},${c.y}`);
  // Add an outline pixel anywhere an empty neighbor touches an occupied
  // non-outline interior cell, but only on the body/torso/head region
  // to avoid outlining scene decorations.
  const outlines: Cell[] = [];
  // Extended up to row 0 so the tall weapon tips (knife/sword/kingsblade
  // reach row 0) get outlined too.
  for (let y = 0; y <= SHOE_Y + 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (occupied.has(`${x},${y}`)) continue;
      // Check 4-neighbors for an occupied interior cell.
      const neighbors = [
        `${x - 1},${y}`,
        `${x + 1},${y}`,
        `${x},${y - 1}`,
        `${x},${y + 1}`,
      ];
      if (neighbors.some((n) => occupied.has(n))) {
        outlines.push({ x, y, color: outline });
      }
    }
  }
  cells.push(...outlines);
}

// ─── Main render ───────────────────────────────────────────────────────

export function renderBrawlerArt(opts: BrawlerArtOpts): string {
  const { tokenId, weaponName, rarity = 'common', isDead = false, bgRarity } = opts;
  const features = rollFeatures(tokenId, rarity);

  // Dead brawlers render the SAME normal art (no grey-out) and get a red
  // bloody cross overlay on top, per D's 2026-04-25 feedback. The brawler
  // remains recognizable; the cross signals "in graveyard, needs resurrect".
  const working: Features = features;

  const bgCells: Cell[] = [];
  const cells: Cell[] = [];

  // bgRarity override, render the bg as if this rarity, otherwise use
  // the scene that rolled with the brawler.
  const bgScene = bgRarity ? sceneForRarity(bgRarity) : working.scene;
  drawScene(bgCells, bgScene);

  // Body, back-to-front.
  drawHead(cells, working);
  drawTorso(cells, working);
  drawArms(cells, working);
  drawLegs(cells, working);

  // Face details go on top of head.
  drawFace(cells, working);
  drawHair(cells, working);
  drawHat(cells, working);
  drawAccessory(cells, working);
  drawFaceMark(cells, working);
  drawSpeciesExtras(cells, working);

  // Items.
  drawOffHand(cells, working);
  drawWeapon(cells, weaponName);

  // Re-stamp the brawler-right horn on top of the weapon so the viking's
  // sledgehammer (cols 4-7, rows 1-4) doesn't bury it. Without this the
  // viewer-left horn vanishes and only the right horn reads. Tied to
  // hatKind, so any horned-helmet wearer benefits.
  if (working.hatKind === 'horned') {
    const horn = '#E4D4A8';
    const hornShade = '#A89060';
    put(cells, HEAD_LEFT - 1, HEAD_TOP - 3, horn);      // (7, 1) tip
    put(cells, HEAD_LEFT - 1, HEAD_TOP - 2, hornShade); // (7, 2) shade
    put(cells, HEAD_LEFT, HEAD_TOP - 2, horn);          // (8, 2) base
  }

  // Pet companion next to the legs (rare+). Higher bling = diamond collar.
  drawPet(cells, working.pet, working.blingLevel);

  // Aura on top of hat/hair.
  drawAura(cells, working.aura);

  // Full-body silhouette outline for crisp definition against any background.
  addSilhouetteOutline(cells, working);

  // Bling, chest gem, corner sparkles, glittery shirt overlay (rare+).
  // Drawn AFTER the outline so corner sparkles stay as clean dots instead
  // of getting outlined into 5-pixel stars.
  drawBling(cells, working);

  // Per-(archetype, rarity) horizontal shift, moves the whole brawler
  // (weapon + body + silhouette + pet + bling) right so the corner crosses
  // on the bg are not buried under the weapon's silhouette outline. 2px
  // was too far per D's 2026-04-27 follow-up; pulled back to 1px.
  const cellKey = `${working.archetype}:${working.rarity}`;
  const SHIFT_RIGHT_1: ReadonlySet<string> = new Set([
    'viking:uncommon',
    'punjab:uncommon',
    'knight:legendary',
    'wrestler:legendary',
    'viking:legendary',
    'mafia:legendary',
    'berserker:epic',
  ]);
  if (SHIFT_RIGHT_1.has(cellKey)) {
    for (const c of cells) c.x += 1;
  }

  const bgRects = compact(bgCells)
    .map((c) => `<rect x="${c.x}" y="${c.y}" width="1" height="1" fill="${c.color}"/>`)
    .join('');
  const rects = compact(cells)
    .map((c) => `<rect x="${c.x}" y="${c.y}" width="1" height="1" fill="${c.color}"/>`)
    .join('');

  // Dead overlay, bright red diagonal X across the body, with a few drips
  // on the lower portion to read as "blood". Drawn over the character so
  // the X clearly marks them as out of action.
  const deadOverlay = isDead ? buildBloodCrossOverlay() : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ` +
    `shape-rendering="crispEdges" width="100%" height="100%" ` +
    `style="display:block;image-rendering:pixelated;">` +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="${RARITY_BG[bgRarity ?? rarity]}"/>` +
    bgRects +
    rects +
    deadOverlay +
    `</svg>`
  );
}

/**
 * Bright red X across the brawler with a few blood drips below. Drawn on
 * top of the normal sprite so a dead brawler is recognisably the SAME
 * character, just visibly out of action.
 */
function buildBloodCrossOverlay(): string {
  const red = '#E61E1E';
  const drip = '#A00808';
  // Two diagonal strokes from corners of the body bounding box, 2px thick.
  // Body box: roughly (4, 4) to (19, 30).
  const rects: Array<{ x: number; y: number; color: string }> = [];
  // Diagonal 1: top-left → bottom-right
  for (let i = 0; i < 24; i++) {
    const x = 3 + Math.round(i * (16 / 23));
    const y = 4 + Math.round(i * (24 / 23));
    rects.push({ x, y, color: red });
    rects.push({ x: x + 1, y, color: red });
  }
  // Diagonal 2: top-right → bottom-left
  for (let i = 0; i < 24; i++) {
    const x = 19 - Math.round(i * (16 / 23));
    const y = 4 + Math.round(i * (24 / 23));
    rects.push({ x, y, color: red });
    rects.push({ x: x + 1, y, color: red });
  }
  // Blood drips at the bottom, a few short vertical streaks.
  const drips: Array<[number, number]> = [
    [6, 26], [6, 27],
    [11, 28], [11, 29], [11, 30],
    [16, 27], [16, 28],
  ];
  for (const [x, y] of drips) {
    rects.push({ x, y, color: drip });
  }
  return rects
    .map((c) => `<rect x="${c.x}" y="${c.y}" width="1" height="1" fill="${c.color}" opacity="0.92"/>`)
    .join('');
}
