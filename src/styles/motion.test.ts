import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { MOTION_MS } from './motion';

// Keeps motion.ts honest against structure.css (the value source), both
// directions: a retuned token whose JS mirror was not moved fails here,
// and so does a new --motion token motion.ts does not know about. Same
// failure-distance move as geometry.test.ts, for durations.

const structureCss = readFileSync(
  fileURLToPath(new URL('./structure.css', import.meta.url)),
  'utf8',
);

function parseDurationMs(value: string): number {
  const match = /^(\d*\.?\d+)(m?s)$/.exec(value.trim());
  if (!match) {
    throw new Error(`--motion token is not a plain duration: ${value}`);
  }
  const amount = Number(match[1]);
  return match[2] === 'ms' ? amount : amount * 1000;
}

function declaredMotionMs(cssText: string): Record<string, number> {
  const durations: Record<string, number> = {};
  postcss.parse(cssText).walkDecls((decl) => {
    if (decl.prop.startsWith('--motion-')) {
      durations[decl.prop] = parseDurationMs(decl.value);
    }
  });
  return durations;
}

describe('motion.ts vs structure.css', () => {
  it('mirrors every --motion token exactly - no drift, no extras, none missing', () => {
    expect({ ...MOTION_MS }).toEqual(declaredMotionMs(structureCss));
  });
});
