// Rest timer math, pure and DB-free so it runs with fake clocks in Node.
// endsAt is derived ONCE at the arrival upsert (loggedAt + restSeconds)
// and never stored or re-derived from a running countdown: a frozen
// background webview must resume onto the correct digits from the wall
// clock, never from a JS interval that kept ticking (or didn't).

export function restEndsAtIso(loggedAt: string, restSeconds: number): string {
  const loggedAtMs = Date.parse(loggedAt);
  if (Number.isNaN(loggedAtMs)) {
    throw new Error(`restEndsAtIso: invalid ISO timestamp: ${loggedAt}`);
  }
  return new Date(loggedAtMs + restSeconds * 1000).toISOString();
}

// Clamps at zero: the rest countdown never counts overtime, and the
// total-workout readout is a separate timer that keeps running regardless.
export function remainingSeconds(endsAtIso: string, nowMs: number): number {
  const endsAtMs = Date.parse(endsAtIso);
  if (Number.isNaN(endsAtMs)) {
    throw new Error(`remainingSeconds: invalid ISO timestamp: ${endsAtIso}`);
  }
  return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000));
}

// M:SS, minutes unpadded (the hero digits run well past 9 minutes on a
// long rest, unlike the fixed HH:MM:SS total-time readout).
export function formatRemaining(totalSeconds: number): string {
  if (!Number.isInteger(totalSeconds) || totalSeconds < 0) {
    throw new Error(`formatRemaining: expected a non-negative integer, got ${totalSeconds}`);
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
