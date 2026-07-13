// Statement classification shared by both sqlite-proxy drivers
// (src/native/database.ts on device, src/db/test-db.ts in Node).
//
// Row-returning writes (INSERT/UPDATE/DELETE ... RETURNING) reach the proxy
// callback with method 'all' or 'get', shaped exactly like a SELECT. The
// Capacitor plugin cannot execute them: it fakes RETURNING by re-running a
// SELECT built from the statement's extracted WHERE text with an EMPTY bind
// list (verified in its Android and iOS 8.1.0 sources), so any parameterized
// or self-invalidating WHERE returns wrong rows on device. .returning() is
// therefore banned outright (eslint.config.mjs, odin/no-returning); both
// drivers use this predicate as the runtime backstop that turns a violation
// that slipped past lint into a loud error instead of silent wrong data.
//
// The heuristic errs toward matching: a WITH-prefixed statement counts as a
// row-returning write whenever it mentions a write verb plus RETURNING
// anywhere, even in a subquery or a string literal. A false positive is a
// loud error at query time; a false negative would be wrong data on device.
// The Node double additionally cross-checks every classification against
// better-sqlite3's own compiler, so drift fails in vitest first.
export function isRowReturningWrite(sql: string): boolean {
  if (/^\s*(insert|update|delete)\b/i.test(sql)) {
    return true;
  }
  return (
    /^\s*with\b/i.test(sql) && /\b(insert|update|delete)\b/i.test(sql) && /\breturning\b/i.test(sql)
  );
}

// The error both drivers throw when a row-returning write reaches them.
export function rowReturningWriteError(sql: string): Error {
  return new Error(
    'row-returning writes are not supported on the device SQLite plugin ' +
      `(RETURNING is faked by a broken re-query); rewrite as separate statements: ${sql}`,
  );
}
