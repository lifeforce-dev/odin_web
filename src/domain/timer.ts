// Timers persist the wall-clock end time (endsAt) and derive everything from
// it. Never store or trust a running countdown: background webviews freeze JS
// timers, so the OS clock is the only source of truth.

export function secondsRemaining(endsAtIso: string, now: Date): number {
  const endsAtMs = Date.parse(endsAtIso);
  if (Number.isNaN(endsAtMs)) {
    throw new Error(`secondsRemaining: invalid ISO timestamp: ${endsAtIso}`);
  }
  return Math.max(0, Math.ceil((endsAtMs - now.getTime()) / 1000));
}
