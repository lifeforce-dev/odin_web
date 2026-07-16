import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// Domain schema. TEXT UUID primary keys (device-generated) and TEXT
// ISO8601 UTC timestamps throughout: exported FKs stay UUIDs with zero
// translation, and the perf cost is irrelevant at one user's data
// volume. Indexes encode access shape, not perf necessity.

// A fresh workout's prescription; the storage default for the columns
// below and the value domain/builder re-exports as DEFAULT_PRESCRIPTION.
export const DEFAULT_PRESCRIPTION = { sets: 3, restSeconds: 60 } as const;

// The exercise pool: one exercise = one durable identity = ONE history
// stream, no matter which circuit points at it.
export const exercise = sqliteTable(
  'exercise',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['workout', 'stretch'] }).notNull(),
    name: text('name').notNull(),
    // The workout's own prescription: sets/rest are properties of the
    // identity, not the slot - membership is exclusive (one circuit
    // per exercise), so a per-slot copy could never legitimately
    // diverge, and the workout is editable wherever it sits. No reps
    // target, by design: reps exist only as logged actuals.
    sets: integer('sets').notNull().default(DEFAULT_PRESCRIPTION.sets),
    restSeconds: integer('rest_seconds').notNull().default(DEFAULT_PRESCRIPTION.restSeconds),
    createdAt: text('created_at').notNull(),
    // Non-null means soft-deleted. Exercises soft-delete because set_log rows
    // reference them; hard delete is only legal when nothing references the row.
    archivedAt: text('archived_at'),
  },
  (table) => [
    // "Unique (normalized) among active": names compare
    // case-insensitively, archived names are free for reuse. Writers
    // trim whitespace; lower() is as much normalization as SQLite can
    // enforce, and find-or-create matches on the same lower(trim)
    // form. CAUTION: without ICU, lower() folds ASCII only, while JS
    // toLowerCase() folds everything - callers must normalize to the
    // index's ASCII-only form (pinned in schema.test.ts).
    uniqueIndex('exercise_active_name_unique')
      .on(sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} IS NULL`),
    // CHECKs guard writers that bypass the TS types: an import, a
    // restore flow, manual SQL. Drizzle's { enum } is compile-time only.
    check('exercise_kind_check', sql`${table.kind} IN ('workout', 'stretch')`),
    check('exercise_name_not_blank_check', sql`length(trim(${table.name})) > 0`),
  ],
);

// Circuits are an ordered rotation scoped by kind; "up next" is derived from
// the last session at read time, never stored.
export const circuit = sqliteTable(
  'circuit',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['workout', 'stretch'] }).notNull(),
    name: text('name').notNull(),
    rotationOrder: integer('rotation_order').notNull(),
    createdAt: text('created_at').notNull(),
    // Non-null means soft-deleted (sessions reference circuits).
    archivedAt: text('archived_at'),
  },
  (table) => [
    index('circuit_kind_rotation_idx').on(table.kind, table.rotationOrder),
    check('circuit_kind_check', sql`${table.kind} IN ('workout', 'stretch')`),
  ],
);

// A slot: a pure circuit -> exercise association plus its position.
// The prescription lives on the exercise itself; this row only says
// "this circuit, this order".
export const circuitItem = sqliteTable(
  'circuit_item',
  {
    id: text('id').primaryKey(),
    // Items are disposable; deleting a circuit takes its slots with it.
    circuitId: text('circuit_id')
      .notNull()
      .references(() => circuit.id, { onDelete: 'cascade' }),
    // restrict: an exercise held by a slot cannot be hard-deleted.
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercise.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
  },
  (table) => [
    // Exclusive membership: one circuit per exercise, enforced by the
    // DB so a "steal" that forgets to delete the old pointer fails
    // loudly instead of silently duplicating. Its implicit index also
    // serves both pool-group queries (AVAILABLE anti-join, owner
    // lookup).
    uniqueIndex('circuit_item_exercise_unique').on(table.exerciseId),
    index('circuit_item_circuit_position_idx').on(table.circuitId, table.position),
  ],
);

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    // Provenance; restrict because circuits soft-delete, never hard-delete
    // while referenced.
    circuitId: text('circuit_id')
      .notNull()
      .references(() => circuit.id, { onDelete: 'restrict' }),
    startedAt: text('started_at').notNull(),
    // Null = in flight or abandoned.
    endedAt: text('ended_at'),
  },
  (table) => [index('session_started_idx').on(table.startedAt)],
);

// Immutable facts of what happened. No slot/item FK: history follows the
// exercise identity, which is what makes circuit items freely deletable.
export const setLog = sqliteTable(
  'set_log',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'restrict' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercise.id, { onDelete: 'restrict' }),
    // 1-based: the "set 2 of 4" fact.
    setIndex: integer('set_index').notNull(),
    reps: integer('reps').notNull(),
    weight: real('weight').notNull(),
    // Captured at log time; a later unit-setting change never re-labels history.
    weightUnit: text('weight_unit', { enum: ['lb', 'kg'] }).notNull(),
    loggedAt: text('logged_at').notNull(),
  },
  (table) => [
    // Last-session lookup + per-exercise history.
    index('set_log_exercise_logged_idx').on(table.exerciseId, table.loggedAt),
    // In-session counts, session reconstruction.
    index('set_log_session_idx').on(table.sessionId),
    check('set_log_weight_unit_check', sql`${table.weightUnit} IN ('lb', 'kg')`),
  ],
);

export type ExerciseRow = typeof exercise.$inferSelect;
export type CircuitRow = typeof circuit.$inferSelect;
export type CircuitItemRow = typeof circuitItem.$inferSelect;
export type SessionRow = typeof session.$inferSelect;
export type SetLogRow = typeof setLog.$inferSelect;
