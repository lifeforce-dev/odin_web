// The Capacitor SQLite plugin returns SELECT results as one object per row,
// keyed by column name. Drizzle's sqlite-proxy driver maps result rows
// positionally (row[columnIndex] against the built SELECT list), so each
// object must be flattened back to its values in column order. JS objects
// preserve string-key insertion order, and the plugin builds each row object
// in result-column order (its iOS layer ships an explicit ios_columns
// manifest to guarantee exactly that), which is what makes Object.values
// order-correct here.
//
// Known limit: two selected columns with the same bare name (joining two
// tables and selecting both "id" columns, for example) collapse into one
// object key before this code ever sees the row, silently misaligning every
// later column. The Node test double (src/db/test-db.ts) materializes object
// rows the same way, so a query with a bare-name collision fails in vitest
// instead of corrupting data on device. Query functions must alias
// same-named columns apart.

export function toPositionalRow(row: Record<string, unknown>): unknown[] {
  return Object.values(row);
}

export function toPositionalRows(rows: Record<string, unknown>[]): unknown[][] {
  return rows.map(toPositionalRow);
}
