import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { GEOMETRY_BOARD_TOKENS, UNBOARDED_TOKENS } from './geometry';

// Keeps geometry.ts honest against structure.css (the value source): a
// declared token that is neither boarded nor exempted, or a listed token
// structure.css no longer declares, fails here instead of the gallery
// silently lying on the device token board. Same failure-distance move
// as check:themes, for the tokens outside the theme contract.

const structureCss = readFileSync(
  fileURLToPath(new URL('./structure.css', import.meta.url)),
  'utf8',
);

function declaredTokens(cssText: string): string[] {
  const props = new Set<string>();
  postcss.parse(cssText).walkDecls((decl) => {
    if (decl.prop.startsWith('--')) {
      props.add(decl.prop);
    }
  });
  return [...props];
}

describe('geometry boards vs structure.css', () => {
  const declared = declaredTokens(structureCss);
  const declaredSet = new Set(declared);
  const boarded = [...GEOMETRY_BOARD_TOKENS];
  const exempted = Object.keys(UNBOARDED_TOKENS);
  const accounted = new Set([...boarded, ...exempted]);

  it('accounts for every declared token: board it or exempt it, consciously', () => {
    expect(declared.filter((token) => !accounted.has(token))).toEqual([]);
  });

  it('lists no token that structure.css does not declare', () => {
    expect([...accounted].filter((token) => !declaredSet.has(token))).toEqual([]);
  });

  it('never both boards and exempts a token', () => {
    const exemptedSet = new Set(exempted);
    expect(boarded.filter((token) => exemptedSet.has(token))).toEqual([]);
  });

  it('boards each token exactly once', () => {
    expect(new Set(boarded).size).toBe(boarded.length);
  });
});
