import { describe, expect, it } from 'vitest';

import { newId } from './ids';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  // No separate uniqueness test: that would test the platform RNG, and a
  // constant/memoized id already fails loudly as a PK violation in every
  // multi-insert DB test.
  it('produces v4 UUIDs', () => {
    expect(newId()).toMatch(UUID_V4);
  });
});
