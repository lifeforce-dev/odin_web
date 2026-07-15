// Primary keys are device-generated UUIDs (schema-v2 standing decision):
// exported rows keep globally unique ids, so the Phase 2 server can import
// them idempotently with no key translation.
//
// crypto.randomUUID is SECURE-CONTEXT-ONLY: it exists in Node and in the
// installed app (https/capacitor origins), but is undefined when the
// WebView loads from the LAN dev server (http://<ip>:5173) - the phone dev
// loop. getRandomValues has no such gate, so the fallback derives the same
// RFC 4122 v4 shape from it. Found on device: the workbench seed silently
// failed only under dev:phone (task 02-04).
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Version nibble = 4, variant bits = 10xx.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}
