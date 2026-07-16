import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';

import type { CircuitItemRow, CircuitRow, ExerciseRow, SessionRow, SetLogRow } from '@/db/schema';

import { buildExport, deserialize, serialize } from './export';
import type { ExportRows } from './export';

// Generators produce rows in the shapes the schema can actually hold: finite
// weights (the log-set control only writes numbers), ISO timestamps, any
// unicode the user can type into a name.

const isoDate = fc
  .date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2100-01-01T00:00:00.000Z'),
    noInvalidDate: true,
  })
  .map((date) => date.toISOString());

const kind = fc.constantFrom<'workout' | 'stretch'>('workout', 'stretch');

// JSON.stringify turns -0 into "0", which would fail the round-trip on a
// technicality no real weight entry can produce; normalize it away. The
// lossiness itself is pinned by an explicit example below.
const weight = fc
  .double({ min: 0, max: 2000, noNaN: true })
  .map((value) => (Object.is(value, -0) ? 0 : value));

// unit 'grapheme' makes the property actually generate the unicode the
// comment above promises; fc.string()'s default unit is printable ASCII
// only (verified in fast-check 4.9.0).
const name = fc.string({ maxLength: 60, unit: 'grapheme' });

const exerciseArb: fc.Arbitrary<ExerciseRow> = fc.record({
  id: fc.uuid(),
  kind,
  name,
  sets: fc.integer({ min: 1, max: 99 }),
  restSeconds: fc.integer({ min: 0, max: 3600 }),
  createdAt: isoDate,
  archivedAt: fc.option(isoDate, { nil: null }),
});

const circuitArb: fc.Arbitrary<CircuitRow> = fc.record({
  id: fc.uuid(),
  kind,
  name,
  rotationOrder: fc.integer({ min: 0, max: 999 }),
  createdAt: isoDate,
  archivedAt: fc.option(isoDate, { nil: null }),
});

const circuitItemArb: fc.Arbitrary<CircuitItemRow> = fc.record({
  id: fc.uuid(),
  circuitId: fc.uuid(),
  exerciseId: fc.uuid(),
  position: fc.integer({ min: 0, max: 99 }),
});

const sessionArb: fc.Arbitrary<SessionRow> = fc.record({
  id: fc.uuid(),
  circuitId: fc.uuid(),
  startedAt: isoDate,
  endedAt: fc.option(isoDate, { nil: null }),
});

const setLogArb: fc.Arbitrary<SetLogRow> = fc.record({
  id: fc.uuid(),
  sessionId: fc.uuid(),
  exerciseId: fc.uuid(),
  setIndex: fc.integer({ min: 1, max: 99 }),
  reps: fc.integer({ min: 0, max: 999 }),
  weight,
  weightUnit: fc.constantFrom<'lb' | 'kg'>('lb', 'kg'),
  loggedAt: isoDate,
});

const exportRowsArb: fc.Arbitrary<ExportRows> = fc.record({
  exercises: fc.array(exerciseArb, { maxLength: 5 }),
  circuits: fc.array(circuitArb, { maxLength: 5 }),
  circuitItems: fc.array(circuitItemArb, { maxLength: 5 }),
  sessions: fc.array(sessionArb, { maxLength: 5 }),
  setLogs: fc.array(setLogArb, { maxLength: 10 }),
});

describe('export contract', () => {
  // The longest-failure-distance surface in the app: a serialization bug here
  // is not caught until a real export hits the Phase 2 server, long after the
  // data was written. Property, not examples.
  test.prop([exportRowsArb, isoDate])('round-trips over generated rows', (rows, exportedAt) => {
    const data = buildExport(rows, exportedAt);
    expect(deserialize(serialize(data))).toEqual(data);
  });

  it('produces exactly the contract envelope', () => {
    const data = buildExport(
      { exercises: [], circuits: [], circuitItems: [], sessions: [], setLogs: [] },
      '2026-07-11T20:00:00.000Z',
    );

    expect(data).toEqual({
      format: 'odin-export',
      schemaVersion: 2,
      exportedAt: '2026-07-11T20:00:00.000Z',
      exercises: [],
      circuits: [],
      circuitItems: [],
      sessions: [],
      setLogs: [],
    });
  });

  it('round-trips names with unicode the user can actually type', () => {
    const rows: ExportRows = {
      exercises: [
        {
          id: '1c7cbe5f-6da8-40a5-a2a5-4b0b9ee2a111',
          kind: 'workout',
          name: 'Pushups // Über 💪',
          sets: 3,
          restSeconds: 60,
          createdAt: '2026-07-11T20:00:00.000Z',
          archivedAt: null,
        },
      ],
      circuits: [],
      circuitItems: [],
      sessions: [],
      setLogs: [],
    };

    // exportedAt pinned: two bare buildExport calls each stamp their own
    // nowIso() and flake apart across a millisecond boundary.
    const built = buildExport(rows, '2026-07-13T20:00:00.000Z');
    expect(deserialize(serialize(built))).toEqual(built);
  });

  it('rejects non-JSON input', () => {
    expect(() => deserialize('not json {')).toThrow('not valid JSON');
  });

  it('rejects a foreign format', () => {
    expect(() => deserialize(JSON.stringify({ format: 'something-else' }))).toThrow(
      "expected format 'odin-export'",
    );
  });

  it('rejects a schemaVersion this app does not understand', () => {
    const data = { ...buildExport(emptyRows()), schemaVersion: 99 };
    expect(() => deserialize(JSON.stringify(data))).toThrow('unsupported export schemaVersion');
  });

  it('rejects an envelope missing a row array', () => {
    const data: Record<string, unknown> = { ...buildExport(emptyRows()) };
    delete data.setLogs;
    expect(() => deserialize(JSON.stringify(data))).toThrow("missing the 'setLogs' row array");
  });

  it('rejects an envelope missing the exportedAt timestamp', () => {
    const data: Record<string, unknown> = { ...buildExport(emptyRows()) };
    delete data.exportedAt;
    expect(() => deserialize(JSON.stringify(data))).toThrow("missing the 'exportedAt' timestamp");
  });

  it('rejects JSON that is not an object', () => {
    expect(() => deserialize('42')).toThrow('must be a JSON object');
  });

  it('exports a -0 weight as 0: JSON has no negative zero', () => {
    // A real wire lossiness, pinned as fact. Harmless for weights, but if a
    // future field can hold a meaningful -0 this is the test to revisit.
    const rows: ExportRows = {
      ...emptyRows(),
      setLogs: [
        {
          id: '5b0f0c9a-2b70-4b1a-9c58-3f6c2f4f2222',
          sessionId: '9d3d6c1b-7a52-4d08-8f21-1a2b3c4d3333',
          exerciseId: '1c7cbe5f-6da8-40a5-a2a5-4b0b9ee2a111',
          setIndex: 1,
          reps: 10,
          weight: -0,
          weightUnit: 'lb',
          loggedAt: '2026-07-13T20:00:00.000Z',
        },
      ],
    };

    const roundTripped = deserialize(serialize(buildExport(rows, '2026-07-13T20:00:00.000Z')));

    expect(Object.is(roundTripped.setLogs[0].weight, 0)).toBe(true);
    expect(Object.is(roundTripped.setLogs[0].weight, -0)).toBe(false);
  });
});

function emptyRows(): ExportRows {
  return { exercises: [], circuits: [], circuitItems: [], sessions: [], setLogs: [] };
}
