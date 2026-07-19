// JS mirrors of the --motion-* duration tokens in structure.css. The
// animation timers that decide when a transient phase ends must agree with
// the CSS animations that fill it; a comment-only mirror could silently
// desync (retune the token and the JS no longer matches). structure.css
// stays the VALUE source: motion.test.ts parses it and fails on drift in
// either direction, so "slow the delete animation" stays the one-line edit
// structure.css promises. This is the geometry.ts parity pattern, applied
// to time.

export const MOTION_MS = {
  '--motion-press': 140,
  '--motion-slide': 150,
  '--motion-flash': 900,
  '--motion-morph': 200,
  '--motion-delete': 360,
  '--motion-tick': 150,
  '--motion-settle': 60,
  '--motion-pulse': 1600,
} as const;

// The named handles the animation code reads.
export const MOTION_MORPH_MS = MOTION_MS['--motion-morph'];
export const MOTION_DELETE_MS = MOTION_MS['--motion-delete'];
export const MOTION_SLIDE_MS = MOTION_MS['--motion-slide'];
export const MOTION_TICK_MS = MOTION_MS['--motion-tick'];
export const MOTION_SETTLE_MS = MOTION_MS['--motion-settle'];
