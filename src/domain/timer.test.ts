import { describe, expect, it } from 'vitest';

import { secondsRemaining } from './timer';

describe('secondsRemaining', () => {
  it('derives whole seconds left from endsAt', () => {
    const now = new Date('2026-07-12T10:00:00.000Z');
    expect(secondsRemaining('2026-07-12T10:01:00.000Z', now)).toBe(60);
  });

  it('rounds partial seconds up so the displayed digit never skips ahead', () => {
    const now = new Date('2026-07-12T10:00:00.500Z');
    expect(secondsRemaining('2026-07-12T10:00:01.000Z', now)).toBe(1);
  });

  it('clamps to zero once endsAt has passed', () => {
    const now = new Date('2026-07-12T10:05:00.000Z');
    expect(secondsRemaining('2026-07-12T10:00:00.000Z', now)).toBe(0);
  });

  it('rejects an invalid timestamp instead of returning NaN', () => {
    expect(() => secondsRemaining('not-a-date', new Date())).toThrow('invalid ISO timestamp');
  });
});
