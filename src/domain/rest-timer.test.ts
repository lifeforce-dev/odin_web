import { describe, expect, it } from 'vitest';

import { formatRemaining, remainingSeconds, restEndsAtIso } from './rest-timer';

describe('restEndsAtIso', () => {
  it('adds restSeconds onto loggedAt', () => {
    expect(restEndsAtIso('2026-07-16T10:00:00.000Z', 90)).toBe('2026-07-16T10:01:30.000Z');
  });

  it('rejects an invalid timestamp instead of returning NaN', () => {
    expect(() => restEndsAtIso('not-a-date', 60)).toThrow('invalid ISO timestamp');
  });
});

describe('remainingSeconds', () => {
  it('derives whole seconds left from endsAt', () => {
    const nowMs = Date.parse('2026-07-16T10:00:00.000Z');
    expect(remainingSeconds('2026-07-16T10:01:30.000Z', nowMs)).toBe(90);
  });

  it('clamps to zero exactly at endsAt', () => {
    const nowMs = Date.parse('2026-07-16T10:01:30.000Z');
    expect(remainingSeconds('2026-07-16T10:01:30.000Z', nowMs)).toBe(0);
  });

  it('clamps to zero once endsAt is in the past (no overtime count)', () => {
    const nowMs = Date.parse('2026-07-16T10:05:00.000Z');
    expect(remainingSeconds('2026-07-16T10:01:30.000Z', nowMs)).toBe(0);
  });

  it('rounds a partial second up so the digit never skips ahead', () => {
    const nowMs = Date.parse('2026-07-16T10:00:00.500Z');
    expect(remainingSeconds('2026-07-16T10:00:01.000Z', nowMs)).toBe(1);
  });

  it('rejects an invalid timestamp instead of returning NaN', () => {
    expect(() => remainingSeconds('not-a-date', Date.now())).toThrow('invalid ISO timestamp');
  });
});

describe('formatRemaining', () => {
  it('formats zero as 0:00', () => {
    expect(formatRemaining(0)).toBe('0:00');
  });

  it('pads seconds but not minutes', () => {
    expect(formatRemaining(65)).toBe('1:05');
  });

  it('runs minutes past nine unpadded', () => {
    expect(formatRemaining(605)).toBe('10:05');
  });

  it('rejects negative or fractional input', () => {
    expect(() => formatRemaining(-1)).toThrow('non-negative integer');
    expect(() => formatRemaining(1.5)).toThrow('non-negative integer');
  });
});
