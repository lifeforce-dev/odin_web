// Primary keys are device-generated UUIDs (schema-v2 standing decision):
// exported rows keep globally unique ids, so the Phase 2 server can import
// them idempotently with no key translation.
export function newId(): string {
  return crypto.randomUUID();
}
