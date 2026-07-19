// The theme contract. Every file in styles/themes/ must define exactly
// these custom properties, all scoped under its own [data-theme]
// selector: no missing, no extra, no leaks. Enforced by npm run
// check:themes (src/styles/contract.test.ts).
//
// Grouped by kind so consumers can render a whole group: the gallery's
// color board renders CONTRACT_COLOR_TOKENS. The sensory groups each
// need a bespoke presentation, so the gallery samples those
// individually.

export const THEMES = ['odin-dark'] as const;

export type ThemeName = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeName = 'odin-dark';

export function isThemeName(value: string): value is ThemeName {
  return (THEMES as readonly string[]).includes(value);
}

// Tier-1 primitives carry this prefix and never appear in the contract.
export const PRIMITIVE_PREFIX = '--raw-';

// Color roles.
export const CONTRACT_COLOR_TOKENS: readonly string[] = [
  '--bg',
  '--surface',
  '--surface-raise',
  // The modal backdrop wash (the notification primer): a translucent
  // dim that drops the screen behind a dialog without hiding it.
  '--scrim',
  '--border',
  '--border-strong',
  '--text',
  '--text-soft',
  '--text-dim',
  '--accent',
  '--accent-deep',
  '--accent-soft',
  '--accent-glow',
  // The ambient state pulse's peak fill (set-progress current box): a
  // near-solid accent wash, paired with --accent-soft as the trough.
  '--accent-pulse',
  '--lock',
  // The done card's dim border: lock-tinted iron, quiet on purpose
  // (the DONE stamp is the only element that reads).
  '--border-lock',
  '--warning',
  // The amber CTA's pressed fill, mirroring --accent-deep on the red
  // channel.
  '--warning-deep',
  '--warning-glow',
  // The floating alarm plate (the workbench's RELEASE TO REMOVE flag):
  // an opaque danger-tinted surface, not a translucent accent wash.
  '--surface-alarm',
  // The inventory/supply channel: steel marks library rows where the
  // accent marks a committed circuit member. -soft is its faded
  // rule/edge ink.
  '--supply',
  '--supply-soft',
  // Brand mark fills (OdinMark.vue): raven 1 (Huginn) and raven 2
  // (Muninn). Themable per skin; the carve color is not a theme choice
  // (it tracks the surface the mark sits on) so it stays out of the
  // contract.
  '--logo-ink',
  '--logo-slate',
];

// Type families (sizes are geometry and live in structure.css).
export const CONTRACT_FONT_TOKENS: readonly string[] = ['--font-display', '--font-mono'];

// Sensory layer: a skin is a vibe, not just a palette.
export const CONTRACT_TEXTURE_TOKENS: readonly string[] = [
  '--texture-grain',
  '--texture-grain-size',
  '--texture-scanline',
];

// Light/shade recipes. Every glow/shadow recipe is a full theme token;
// components never write shadow geometry inline. The glow-ink color
// tokens (--accent-glow, --warning-glow) are the one-edit knobs these
// recipes derive from.
export const CONTRACT_GLOW_TOKENS: readonly string[] = [
  '--glow-cta',
  '--glow-display-accent',
  // The armed delete target: the one destructive destination and the only
  // region that earns a red armed glow. Armed zones are otherwise
  // stated by luminance (see --lift-dim).
  '--glow-delete-armed',
  '--glow-flash',
  // The circuit card's Lock On press: a faint interior wash, no outer
  // light - the reticle ticks carry the accent, the glow only warms
  // the plate under the finger.
  '--glow-lock-on',
  '--glow-drag-ghost',
  '--glow-rest-value',
  '--shadow-inset',
  // The page's stepped luminance drop while a card is lifted (a filter
  // recipe)...
  '--lift-dim',
  // ...and the white sweep-line event glow, deliberately off the red
  // channel: the bright event spends luminance, never the accent.
  '--glow-sweep-line',
];

// Derived from the groups above, so a token added to a group is part of
// the check automatically and the groups can never drift from the whole.
export const THEME_CONTRACT: readonly string[] = [
  ...CONTRACT_COLOR_TOKENS,
  ...CONTRACT_FONT_TOKENS,
  ...CONTRACT_TEXTURE_TOKENS,
  ...CONTRACT_GLOW_TOKENS,
];

export interface ContractDiff {
  missing: string[];
  extra: string[];
}

export function diffAgainstContract(definedProperties: string[]): ContractDiff {
  const tier2 = definedProperties.filter((name) => !name.startsWith(PRIMITIVE_PREFIX));
  return {
    missing: THEME_CONTRACT.filter((token) => !tier2.includes(token)),
    extra: tier2.filter((token) => !THEME_CONTRACT.includes(token)),
  };
}
