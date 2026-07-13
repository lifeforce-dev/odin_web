// Timestamps are TEXT ISO8601 UTC with milliseconds (schema-v2 standing
// decision). One helper keeps the format single-sourced.
export function nowIso(): string {
  return new Date().toISOString();
}
