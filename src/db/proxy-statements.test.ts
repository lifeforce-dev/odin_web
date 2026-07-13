import { describe, expect, it } from 'vitest';

import { isRowReturningWrite } from './proxy-statements';

// The predicate is the device driver's runtime backstop against banned
// .returning() queries (src/native/database.ts rejects on a match). Every
// db test additionally cross-checks it against better-sqlite3's compiler
// via the double's classifier-drift tripwire (src/db/test-db.ts); these
// unit tests pin the edges no query in the suite happens to exercise.
describe('isRowReturningWrite', () => {
  it('matches plain writes in any casing and leading whitespace', () => {
    expect(isRowReturningWrite('insert into t (id) values (?) returning id')).toBe(true);
    expect(isRowReturningWrite('  UPDATE t SET x = ? WHERE id = ? RETURNING id')).toBe(true);
    expect(isRowReturningWrite('\n\tDelete From t Where id = ? Returning *')).toBe(true);
  });

  it('does not match reads', () => {
    expect(isRowReturningWrite('select * from t where id = ?')).toBe(false);
    expect(isRowReturningWrite('with recent as (select * from t) select * from recent')).toBe(
      false,
    );
    expect(isRowReturningWrite('begin')).toBe(false);
    expect(isRowReturningWrite('PRAGMA foreign_keys')).toBe(false);
  });

  it('matches CTE-prefixed writes that carry RETURNING', () => {
    // Drizzle can emit these via $with; the bare ^insert|update|delete
    // prefix check alone would misclassify them as reads.
    expect(
      isRowReturningWrite('with doomed as (select id from t) delete from t returning id'),
    ).toBe(true);
    expect(
      isRowReturningWrite('WITH src AS (SELECT 1) INSERT INTO t SELECT * FROM src RETURNING id'),
    ).toBe(true);
  });

  it('does not match a name-only mention of a write verb without RETURNING', () => {
    // "update" appearing as data inside a CTE-shaped read is fine as long
    // as no RETURNING appears; the deliberate false-positive zone is only
    // entered when both a write verb and RETURNING are present.
    expect(isRowReturningWrite("with x as (select 'update me' as label) select * from x")).toBe(
      false,
    );
  });
});
