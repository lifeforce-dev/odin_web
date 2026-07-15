import { afterEach, describe, expect, it, vi } from 'vitest';

import { newId } from './ids';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newId', () => {
  // No separate uniqueness test: that would test the platform RNG, and a
  // constant/memoized id already fails loudly as a PK violation in every
  // multi-insert DB test.
  it('produces v4 UUIDs', () => {
    expect(newId()).toMatch(UUID_V4);
  });

  it('produces v4 UUIDs without crypto.randomUUID (insecure dev-server origin)', () => {
    // The phone dev loop's WebView origin is http://<ip>:5173, where the
    // secure-context-only randomUUID does not exist. Only getRandomValues
    // may be relied on there.
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    });

    expect('randomUUID' in globalThis.crypto).toBe(false);
    expect(newId()).toMatch(UUID_V4);
    expect(newId()).not.toBe(newId());
  });
});
