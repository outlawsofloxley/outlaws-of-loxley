/**
 * JSON helpers that safely round-trip bigint values.
 *
 * Standard JSON.stringify throws on bigint. We encode bigints as strings
 * prefixed with "0x" so they're human-readable and unambiguous, then decode
 * them back to bigint on load.
 *
 * This lets us persist structures like FightResult (which contains bigint seed)
 * to data/brawlers.json without losing precision or type safety.
 */

/** Marker prefix for encoded bigints. */
const BIGINT_PREFIX = '__bigint__:';

/**
 * JSON.stringify replacer that converts bigint to tagged strings.
 * Usage: JSON.stringify(obj, replacer)
 */
export function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return BIGINT_PREFIX + value.toString(16);
  }
  return value;
}

/**
 * JSON.parse reviver that decodes tagged strings back to bigint.
 * Usage: JSON.parse(str, reviver)
 */
export function reviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith(BIGINT_PREFIX)) {
    const hex = value.slice(BIGINT_PREFIX.length);
    return BigInt('0x' + hex);
  }
  return value;
}

/** Stringify with bigint support. */
export function stringify(value: unknown, space?: string | number): string {
  return JSON.stringify(value, replacer, space);
}

/** Parse with bigint support. Throws on invalid JSON. */
export function parse<T = unknown>(text: string): T {
  return JSON.parse(text, reviver) as T;
}
