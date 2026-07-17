// JS mirrors of the --motion-* duration tokens in structure.css. The
// choreography timers that decide when a transient phase DROPS must
// agree with the CSS animations that fill it; a comment-only mirror has
// infinite failure distance (retune the token and the JS desyncs
// silently). structure.css stays the VALUE source: motion.test.ts
// parses it and fails on drift in either direction, so "slow the
// consume animation" stays the one-line edit structure.css promises.
// This is the geometry.ts parity pattern, applied to time.

export const MOTION_MS = {
  '--motion-press': 140,
  '--motion-slide': 150,
  '--motion-flash': 900,
  '--motion-morph': 200,
  '--motion-consume': 360,
  '--motion-tick': 150,
  '--motion-settle': 60,
  '--motion-pulse': 1600,
} as const;

// The named handles the choreography code reads.
export const MOTION_MORPH_MS = MOTION_MS['--motion-morph'];
export const MOTION_CONSUME_MS = MOTION_MS['--motion-consume'];
export const MOTION_SLIDE_MS = MOTION_MS['--motion-slide'];
export const MOTION_TICK_MS = MOTION_MS['--motion-tick'];
export const MOTION_SETTLE_MS = MOTION_MS['--motion-settle'];
