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

// Count-up twin of secondsRemaining, for the total-workout readout.
// Floors where remaining ceils: an elapsed digit shows completed
// seconds, so neither readout ever runs ahead of the clock.
export function secondsElapsed(startedAtIso: string, now: Date): number {
  const startedAtMs = Date.parse(startedAtIso);
  if (Number.isNaN(startedAtMs)) {
    throw new Error(`secondsElapsed: invalid ISO timestamp: ${startedAtIso}`);
  }
  return Math.max(0, Math.floor((now.getTime() - startedAtMs) / 1000));
}

// The HH:MM:SS readout shape the total-time widget renders.
export function formatHms(totalSeconds: number): string {
  if (!Number.isInteger(totalSeconds) || totalSeconds < 0) {
    throw new Error(`formatHms: expected a non-negative integer, got ${totalSeconds}`);
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}
