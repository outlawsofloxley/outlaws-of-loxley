/**
 * Seeded deterministic random number generator.
 *
 * We use xorshift128+ because:
 *   1. It's deterministic, same seed always produces the same sequence.
 *      This is critical: we need to be able to replay any duel later
 *      given its seed, and the on-chain version must produce identical
 *      results.
 *   2. It's fast and passes all standard statistical tests.
 *   3. It's ~10 lines of code and trivial to port to Solidity later.
 *   4. Unlike Math.random(), it's not dependent on V8 implementation
 *      details, it's stable across Node versions and platforms.
 *
 * State is two 64-bit unsigned integers (we use `bigint` since JS numbers
 * only give us 53 bits of integer precision).
 */

export interface RngState {
  s0: bigint;
  s1: bigint;
}

const MASK_64 = (1n << 64n) - 1n;

/**
 * Create a new RNG state from a seed.
 *
 * The seed is any bigint. We do a SplitMix64 initialization pass to avoid
 * "weak" seeds (small numbers, zeroes) producing statistically poor
 * sequences. SplitMix64 is the standard way to initialize xorshift states.
 */
export function createRng(seed: bigint): RngState {
  if (seed < 0n) {
    throw new Error('Seed must be non-negative');
  }
  // SplitMix64, standard seed mixer. Two iterations give us two 64-bit words.
  let z = (seed + 0x9e3779b97f4a7c15n) & MASK_64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  const s0 = z ^ (z >> 31n);
  z = (s0 + 0x9e3779b97f4a7c15n) & MASK_64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  const s1 = z ^ (z >> 31n);
  // Guard against the degenerate all-zeros state
  if (s0 === 0n && s1 === 0n) {
    return { s0: 1n, s1: 2n };
  }
  return { s0: s0 & MASK_64, s1: s1 & MASK_64 };
}

/**
 * Advance the RNG and return the next 64-bit value.
 * MUTATES state. Pass state by reference.
 */
export function nextUint64(state: RngState): bigint {
  let s1 = state.s0;
  const s0 = state.s1;
  const result = (s0 + s1) & MASK_64;
  state.s0 = s0;
  s1 = s1 ^ ((s1 << 23n) & MASK_64);
  state.s1 = (s1 ^ s0 ^ (s1 >> 17n) ^ (s0 >> 26n)) & MASK_64;
  return result;
}

/**
 * Return an integer in the range [min, max] inclusive.
 * Uses rejection sampling to avoid modulo bias.
 */
export function nextInt(state: RngState, min: number, max: number): number {
  if (min > max) {
    throw new Error(`nextInt: min (${min}) must be <= max (${max})`);
  }
  if (min === max) {
    return min;
  }
  const range = BigInt(max - min + 1);
  // Rejection sampling: find the largest multiple of `range` that fits in u64,
  // then reroll if we land in the "bias zone".
  const maxValid = ((1n << 64n) / range) * range;
  let roll: bigint;
  do {
    roll = nextUint64(state);
  } while (roll >= maxValid);
  return min + Number(roll % range);
}

/**
 * Return a float in [0, 1). Uses the top 53 bits of a u64, which is exactly
 * the precision of a JS number.
 */
export function nextFloat(state: RngState): number {
  const value = nextUint64(state) >> 11n;
  return Number(value) / Number(1n << 53n);
}

/**
 * Pick one item from a weighted list. Returns an index into the array.
 * Weights must all be positive. Throws if the list is empty or all-zero.
 */
export function weightedPick<T>(
  state: RngState,
  items: readonly T[],
  weights: readonly number[],
): number {
  if (items.length === 0) {
    throw new Error('weightedPick: items empty');
  }
  if (items.length !== weights.length) {
    throw new Error(
      `weightedPick: items length (${items.length}) must equal weights length (${weights.length})`,
    );
  }
  let total = 0;
  for (const w of weights) {
    if (w < 0) {
      throw new Error('weightedPick: all weights must be non-negative');
    }
    total += w;
  }
  if (total <= 0) {
    throw new Error('weightedPick: weights sum must be positive');
  }
  // Roll a uniform integer in [0, total - 1] and find the bucket.
  // Integer-only; stays deterministic across platforms.
  const roll = nextInt(state, 0, total - 1);
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i]!;
    if (roll < cumulative) {
      return i;
    }
  }
  // Unreachable if total > 0 and weights are finite.
  /* istanbul ignore next */
  throw new Error('weightedPick: unreachable');
}

/**
 * Roll a dice: count * dN + bonus. Classic TTRPG notation.
 * Example: d20Roll(state, 1, 20, 0) rolls 1d20.
 */
export function dice(state: RngState, count: number, sides: number, bonus: number = 0): number {
  if (count <= 0 || sides <= 0) {
    throw new Error(`dice: invalid count/sides (${count}d${sides})`);
  }
  let total = bonus;
  for (let i = 0; i < count; i++) {
    total += nextInt(state, 1, sides);
  }
  return total;
}
