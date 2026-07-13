import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME, diffAgainstContract, THEME_CONTRACT, THEMES } from './contract';

// This file IS npm run check:themes: every theme css must answer the
// contract exactly and keep everything scoped under its own [data-theme]
// selector, and structure.css/base.css must stay out of theming entirely.

const themesDir = fileURLToPath(new URL('./themes/', import.meta.url));

function readThemeCss(theme: string): string {
  return readFileSync(new URL(`./themes/${theme}.css`, import.meta.url), 'utf8');
}

interface ThemeCssShape {
  tokens: string[];
  violations: string[];
}

// A theme file must be exactly top-level [data-theme='<name>'] rules (its
// OWN name, either quote style) whose declarations are all custom
// properties. Anything else - a :root or body block, a media query, a
// nested rule, a non-token declaration - would leak past the file-swap
// contract, so it is reported as a violation instead of silently counted
// or ignored. Parsing (not regex-scraping) also keeps --x: text inside
// url() data-URIs and comments from being mistaken for declarations.
function analyzeThemeCss(cssText: string, theme: string): ThemeCssShape {
  const ownSelector = new RegExp(`^\\[data-theme=["']${theme}["']\\]$`);
  const tokens = new Set<string>();
  const violations: string[] = [];

  for (const node of postcss.parse(cssText).nodes) {
    if (node.type === 'comment') {
      continue;
    }
    if (node.type !== 'rule' || !ownSelector.test(node.selector)) {
      violations.push(node.type === 'rule' ? `selector "${node.selector}"` : `${node.type} node`);
      continue;
    }
    for (const child of node.nodes) {
      if (child.type === 'comment') {
        continue;
      }
      if (child.type !== 'decl' || !child.prop.startsWith('--')) {
        violations.push(`non-token content under "${node.selector}"`);
        continue;
      }
      tokens.add(child.prop);
    }
  }
  return { tokens: [...tokens], violations };
}

function declaredCustomProperties(cssText: string): string[] {
  const props = new Set<string>();
  postcss.parse(cssText).walkDecls((decl) => {
    if (decl.prop.startsWith('--')) {
      props.add(decl.prop);
    }
  });
  return [...props];
}

function ruleSelectors(cssText: string): string[] {
  const selectors: string[] = [];
  postcss.parse(cssText).walkRules((rule) => {
    selectors.push(rule.selector);
  });
  return selectors;
}

describe('themes directory', () => {
  it('holds exactly the declared themes', () => {
    const files = readdirSync(themesDir).filter((name) => name.endsWith('.css'));
    expect(files.sort()).toEqual([...THEMES].map((theme) => `${theme}.css`).sort());
  });
});

describe.each([...THEMES])('theme %s', (theme) => {
  const shape = analyzeThemeCss(readThemeCss(theme), theme);

  it('scopes everything under its own top-level [data-theme] rule', () => {
    expect(shape.violations).toEqual([]);
  });

  it('answers the contract exactly (no missing, no extra tokens)', () => {
    expect(diffAgainstContract(shape.tokens)).toEqual({ missing: [], extra: [] });
  });
});

describe('the shipped default theme', () => {
  it('matches the static data-theme in index.html (one source of truth)', () => {
    const indexHtml = readFileSync(
      fileURLToPath(new URL('../../index.html', import.meta.url)),
      'utf8',
    );
    expect(indexHtml).toContain(`data-theme="${DEFAULT_THEME}"`);
  });
});

describe.each(['structure.css', 'base.css'])('%s stays out of theming', (file) => {
  const css = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');

  it('defines no contract token', () => {
    expect(declaredCustomProperties(css).filter((token) => THEME_CONTRACT.includes(token))).toEqual(
      [],
    );
  });

  it('contains no theme scope', () => {
    expect(ruleSelectors(css).filter((selector) => selector.includes('[data-theme'))).toEqual([]);
  });
});

describe('contract diffing (what a broken theme file triggers)', () => {
  it('flags a removed token as missing', () => {
    const withoutAccent = THEME_CONTRACT.filter((token) => token !== '--accent');
    expect(diffAgainstContract([...withoutAccent])).toEqual({
      missing: ['--accent'],
      extra: [],
    });
  });

  it('flags an undeclared token as extra', () => {
    expect(diffAgainstContract([...THEME_CONTRACT, '--rogue'])).toEqual({
      missing: [],
      extra: ['--rogue'],
    });
  });

  it('exempts tier-1 primitives from the diff', () => {
    expect(diffAgainstContract([...THEME_CONTRACT, '--raw-anything'])).toEqual({
      missing: [],
      extra: [],
    });
  });
});

describe('theme css analysis (what a mis-scoped theme file triggers)', () => {
  it('counts scoped tokens and ignores comments and var() usages', () => {
    const css = `
      /* --commented-out: #fff; */
      [data-theme='x'] {
        /* an inner comment */
        --real: var(--raw-thing);
      }
    `;
    expect(analyzeThemeCss(css, 'x')).toEqual({ tokens: ['--real'], violations: [] });
  });

  it('accepts either quote style on the theme selector', () => {
    const css = `[data-theme="x"] { --a: red; }`;
    expect(analyzeThemeCss(css, 'x')).toEqual({ tokens: ['--a'], violations: [] });
  });

  it('does not mistake custom-property-like text inside a url() for a declaration', () => {
    const css = `[data-theme='x'] { --g: url("data:image/svg+xml,%3Csvg --fake: 1 %3E"); }`;
    expect(analyzeThemeCss(css, 'x').tokens).toEqual(['--g']);
  });

  it('flags tokens declared outside the theme scope instead of counting them', () => {
    const css = `
      [data-theme='x'] { --a: red; }
      body { --leak: blue; }
      @media (width >= 400px) { [data-theme='x'] { --b: green; } }
    `;
    const shape = analyzeThemeCss(css, 'x');
    expect(shape.tokens).toEqual(['--a']);
    expect(shape.violations).toEqual(['selector "body"', 'atrule node']);
  });

  it('flags a :root block and a foreign theme selector', () => {
    const css = `
      :root { --a: red; }
      [data-theme='other'] { --b: blue; }
    `;
    expect(analyzeThemeCss(css, 'x').violations).toEqual([
      'selector ":root"',
      `selector "[data-theme='other']"`,
    ]);
  });

  it('flags a non-token declaration inside the theme rule', () => {
    const css = `[data-theme='x'] { color: red; }`;
    expect(analyzeThemeCss(css, 'x').violations).toEqual([
      `non-token content under "[data-theme='x']"`,
    ]);
  });
});
