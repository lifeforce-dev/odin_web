import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';

// The stylelint token wall is config, and config can fail OPEN: a widened
// glob, a regex that stops matching, or a stylelint upgrade turns the wall
// off while every existing (compliant) file keeps passing. These tests
// re-prove the wall's negative cases on every run by linting probe
// snippets through the real .stylelintrc.json, replacing the one-time
// manual probe component from the 01-05 acceptance pass.

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const configFile = join(repoRoot, '.stylelintrc.json');

async function firedRules(relativePath: string, code: string): Promise<string[]> {
  const { results } = await stylelint.lint({
    code,
    codeFilename: join(repoRoot, relativePath),
    configFile,
  });
  return [...new Set(results[0].warnings.map((warning) => warning.rule))].sort();
}

const offendingSfc = `<style scoped>
.probe {
  color: #fff;
  background: rgb(0 0 0);
  padding: 12px;
  font: 13px monospace;
  font-size: 13px;
  margin-top: 100vh;
  top: env(safe-area-inset-top);
}
</style>`;

const rawColorCss = `.probe {
  color: #fff;
  background: rgb(0 0 0 / 30%);
}`;

const structureCss = `:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --type-probe: clamp(40px, 12vw, 46px);
}`;

const viewportSfc = `<style scoped>
.app-shell {
  height: 100dvh;
}
</style>`;

const trackingSfc = `<style scoped>
.probe {
  letter-spacing: 2px;
}
</style>`;

describe('the token wall on component styles', () => {
  // The file's first lint pays stylelint's one-time init (config
  // resolution + the html custom syntax), which straddles the 5s
  // default on a loaded Windows machine (seen 4.0-5.9s, 2026-07-15).
  // Only this first test needs the headroom; the rest run warm.
  it(
    'rejects raw colors, px in spacing/font, viewport units, and env()',
    { timeout: 15000 },
    async () => {
      expect(await firedRules('src/components/ProbeCard.vue', offendingSfc)).toEqual([
        'color-no-hex',
        'declaration-property-value-disallowed-list',
        'function-disallowed-list',
        'unit-disallowed-list',
      ]);
    },
  );

  it('rejects dvh outside AppShell', async () => {
    expect(await firedRules('src/components/ProbeShell.vue', viewportSfc)).toEqual([
      'unit-disallowed-list',
    ]);
  });

  it('rejects raw px letter-spacing (tracking is tokenized geometry)', async () => {
    expect(await firedRules('src/components/ProbeTracking.vue', trackingSfc)).toEqual([
      'declaration-property-value-disallowed-list',
    ]);
  });
});

describe('the carve-outs (part of the contract too)', () => {
  it('lets theme files use raw color literals', async () => {
    expect(await firedRules('src/styles/themes/probe.css', rawColorCss)).toEqual([]);
  });

  it('still walls base.css off from raw colors', async () => {
    expect(await firedRules('src/styles/base.css', rawColorCss)).toEqual([
      'color-no-hex',
      'function-disallowed-list',
    ]);
  });

  it('lets structure.css use env() and vw, and nothing else does', async () => {
    expect(await firedRules('src/styles/structure.css', structureCss)).toEqual([]);
    expect(await firedRules('src/components/probe.css', structureCss)).toEqual([
      'function-disallowed-list',
      'unit-disallowed-list',
    ]);
  });

  it('lets AppShell (only) use dvh', async () => {
    expect(await firedRules('src/components/AppShell.vue', viewportSfc)).toEqual([]);
  });
});
