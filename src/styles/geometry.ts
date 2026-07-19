// Geometry token boards: the name source the gallery renders from;
// structure.css stays the value source. geometry.test.ts parses
// structure.css and fails on drift in either direction, so a token
// minted there must be boarded (or consciously exempted) here and a
// curated list cannot go silently stale. This is the contract.ts
// pattern applied to the tokens the theme contract cannot see
// (geometry is deliberately not themable).

export const MONO_TYPE_TOKENS = [
  '--type-micro',
  '--type-label',
  '--type-body',
  '--type-data',
  '--type-data-lg',
  '--type-data-xl',
] as const;

export const DISPLAY_TYPE_TOKENS = [
  '--type-display-title',
  '--type-display-wordmark',
  '--type-display-value',
  '--type-display-readout',
  '--type-display-badge',
  '--type-display-stamp',
  '--type-display-stat',
] as const;

export const TRACKING_TOKENS = [
  '--tracking-05',
  '--tracking-1',
  '--tracking-15',
  '--tracking-2',
  '--tracking-3',
  '--tracking-4',
] as const;

export const SPACING_TOKENS = [
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-6',
  '--space-8',
  '--space-12',
] as const;

export const BORDER_TOKENS = ['--hairline', '--rule', '--stamp'] as const;

export const SAFE_AREA_TOKENS = [
  '--safe-top',
  '--safe-bottom',
  '--safe-left',
  '--safe-right',
] as const;

// Every token some gallery board renders as a list row (or live probe).
export const GEOMETRY_BOARD_TOKENS: readonly string[] = [
  ...MONO_TYPE_TOKENS,
  ...DISPLAY_TYPE_TOKENS,
  ...TRACKING_TOKENS,
  ...SPACING_TOKENS,
  ...BORDER_TOKENS,
  ...SAFE_AREA_TOKENS,
];

// Declared in structure.css but deliberately not a board row; each entry
// says how the gallery covers the token instead (or why it cannot). A
// new structure.css token appearing in neither place fails the parity
// test, so the board-or-exempt decision is always made consciously.
export const UNBOARDED_TOKENS: Readonly<Record<string, string>> = {
  '--tap-min': 'bespoke tap-target sample section',
  '--type-display-hero':
    'boarded live via the RestDigits component sample, plus the bespoke countdown sample under the display board',
  '--z-docked': 'z-layers stack; they do not swatch',
  '--z-float': 'z-layers stack; they do not swatch',
  '--z-scanline': 'z-layers stack; they do not swatch',
  '--z-ghost': 'z-layers stack; they do not swatch',
  '--motion-press': 'durations animate; they do not swatch statically',
  '--motion-slide': 'durations animate; they do not swatch statically',
  '--motion-flash': 'durations animate; they do not swatch statically',
  '--motion-morph': 'durations animate; they do not swatch statically',
  '--motion-delete': 'durations animate; they do not swatch statically',
  '--motion-tick': 'durations animate; they do not swatch statically',
  '--motion-settle': 'durations animate; they do not swatch statically',
  '--motion-pulse': 'durations animate; they do not swatch statically',
  '--badge-cell-width': 'a single layout width; the workbench slot number is its live sample',
  '--leading-notice': 'a unitless line-height; the verdict notices are its live sample',
  '--leading-display-title':
    'a unitless line-height; the screen-header editable sample is its live sample',
  '--circuit-card-min': 'a single tile floor; the circuit-card board rows are its live sample',
  '--dim-drag-origin': 'a drag-only state opacity; not swatchable statically',
  '--dim-drag-ghost': 'a drag-only state opacity; not swatchable statically',
  '--dim-disabled':
    'a state opacity; the circuit-row dimmed and menu-button disabled samples show it live',
};
