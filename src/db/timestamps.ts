// Timestamps are TEXT ISO8601 UTC with milliseconds. One helper keeps
// the format single-sourced.
export function nowIso(): string {
  return new Date().toISOString();
}
