import { describe, expect, it } from 'vitest';

import { formatHms, secondsElapsed, secondsRemaining } from './timer';

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

describe('secondsElapsed', () => {
  it('derives whole seconds since startedAt', () => {
    const now = new Date('2026-07-16T10:01:00.000Z');
    expect(secondsElapsed('2026-07-16T10:00:00.000Z', now)).toBe(60);
  });

  it('floors partial seconds so the count-up never runs ahead', () => {
    const now = new Date('2026-07-16T10:00:01.900Z');
    expect(secondsElapsed('2026-07-16T10:00:00.000Z', now)).toBe(1);
  });

  it('clamps to zero when startedAt sits in the future (clock skew)', () => {
    const now = new Date('2026-07-16T10:00:00.000Z');
    expect(secondsElapsed('2026-07-16T10:05:00.000Z', now)).toBe(0);
  });

  it('rejects an invalid timestamp instead of returning NaN', () => {
    expect(() => secondsElapsed('not-a-date', new Date())).toThrow('invalid ISO timestamp');
  });
});

describe('formatHms', () => {
  it('formats zero as 00:00:00', () => {
    expect(formatHms(0)).toBe('00:00:00');
  });

  it('pads every field to two digits', () => {
    expect(formatHms(3661)).toBe('01:01:01');
  });

  it('carries minutes and hours over correctly', () => {
    expect(formatHms(59)).toBe('00:00:59');
    expect(formatHms(60)).toBe('00:01:00');
    expect(formatHms(36_000)).toBe('10:00:00');
  });

  it('rejects negative or fractional input', () => {
    expect(() => formatHms(-1)).toThrow('non-negative integer');
    expect(() => formatHms(1.5)).toThrow('non-negative integer');
  });
});
