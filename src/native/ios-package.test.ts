import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// `cap sync` on Windows writes the SPM local-package paths with backslash
// separators. Swift string literals read backslashes as escapes (`\.` and
// `\@` are compile errors, `\n` is a newline), so the manifest cannot
// compile on the Mac, where nobody re-runs sync before the first build.
// SwiftPM accepts forward slashes on every host; after any Windows
// `cap sync`, hand-fix the paths back to forward slashes.
const packageManifestUrl = new URL('../../ios/App/CapApp-SPM/Package.swift', import.meta.url);

describe('ios Package.swift', () => {
  it('contains no backslash paths (Windows cap sync regression)', () => {
    const manifest = readFileSync(packageManifestUrl, 'utf8');

    expect(manifest).not.toContain('\\');
  });
});
