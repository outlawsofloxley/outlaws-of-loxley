import { describe, it, expect } from 'vitest';
import { stringify, parse } from '../src/util/json.js';

describe('util/json', () => {
  it('round-trips primitives', () => {
    expect(parse(stringify(null))).toBe(null);
    expect(parse(stringify(42))).toBe(42);
    expect(parse(stringify('hello'))).toBe('hello');
    expect(parse(stringify(true))).toBe(true);
  });

  it('round-trips bigints', () => {
    const input = { seed: 0xdeadbeefcafen };
    const serialized = stringify(input);
    const roundTripped = parse<{ seed: bigint }>(serialized);
    expect(roundTripped.seed).toBe(0xdeadbeefcafen);
    expect(typeof roundTripped.seed).toBe('bigint');
  });

  it('round-trips nested bigints', () => {
    const input = {
      seed: 42n,
      nested: { deeper: { id: 0x1234567890abcdefn } },
      arr: [1n, 2n, 3n],
    };
    const roundTripped = parse<typeof input>(stringify(input));
    expect(roundTripped.seed).toBe(42n);
    expect(roundTripped.nested.deeper.id).toBe(0x1234567890abcdefn);
    expect(roundTripped.arr).toEqual([1n, 2n, 3n]);
  });

  it('round-trips zero bigint', () => {
    const r = parse<{ v: bigint }>(stringify({ v: 0n }));
    expect(r.v).toBe(0n);
  });

  it('does not corrupt strings that look like bigint markers', () => {
    const input = { label: 'hello world' };
    const r = parse<typeof input>(stringify(input));
    expect(r.label).toBe('hello world');
  });

  it('throws on invalid JSON', () => {
    expect(() => parse('not json')).toThrow();
  });
});
