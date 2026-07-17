import type { CircuitItemRow, CircuitRow, ExerciseRow, SessionRow, SetLogRow } from '@/db/schema';
import { nowIso } from '@/db/timestamps';

// The device-to-server export contract. Rows serialize as-is: the
// properties ARE the drizzle row objects' fields (camelCase), no
// mapping layer to get wrong. Everything exports, including archived
// rows and unfinished sessions; the export never filters facts.

export const EXPORT_FORMAT = 'odin-export';

// The DB schema version the rows conform to. Importers branch on it;
// bump it in the same change as any migration that alters an exported
// shape. v2: the prescription moved onto the exercise row (sets,
// restSeconds) and circuit_item became a pure association. v3: session
// gained outcome ('completed' | 'abandoned', null while in flight).
export const EXPORT_SCHEMA_VERSION = 3;

export interface ExportRows {
  exercises: ExerciseRow[];
  circuits: CircuitRow[];
  circuitItems: CircuitItemRow[];
  sessions: SessionRow[];
  setLogs: SetLogRow[];
}

export interface OdinExport extends ExportRows {
  format: typeof EXPORT_FORMAT;
  schemaVersion: number;
  exportedAt: string;
}

export function buildExport(rows: ExportRows, exportedAt: string = nowIso()): OdinExport {
  return {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt,
    exercises: rows.exercises,
    circuits: rows.circuits,
    circuitItems: rows.circuitItems,
    sessions: rows.sessions,
    setLogs: rows.setLogs,
  };
}

// Pretty-printed: an export is a support artifact as much as a payload, and
// at one user's data volume the size difference is noise.
export function serialize(data: OdinExport): string {
  return JSON.stringify(data, null, 2);
}

// Envelope validation only, and fail fast with context. Full row-level
// validation is the importer's job; this parser only accepts the one
// version this app itself writes.
export function deserialize(text: string): OdinExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error('export is not valid JSON', { cause });
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('export must be a JSON object');
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.format !== EXPORT_FORMAT) {
    throw new Error(
      `not an odin export: expected format '${EXPORT_FORMAT}', got '${String(envelope.format)}'`,
    );
  }
  if (envelope.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    // Deliberately hard: only the version this app writes. When a
    // device-side restore ships it needs upgrade branches here, not a
    // bigger error message - older files exist in the wild the moment
    // anyone exported before the matching migration. v1 -> v2: hoist
    // each held slot's sets/restSeconds onto its exercise row.
    // v2 -> v3: backfill outcome 'completed' onto ended sessions (the
    // same rule as migration 0002).
    throw new Error(
      `unsupported export schemaVersion: expected ${EXPORT_SCHEMA_VERSION}, ` +
        `got ${String(envelope.schemaVersion)}`,
    );
  }
  if (typeof envelope.exportedAt !== 'string') {
    throw new Error("export is missing the 'exportedAt' timestamp");
  }
  for (const key of ['exercises', 'circuits', 'circuitItems', 'sessions', 'setLogs'] as const) {
    if (!Array.isArray(envelope[key])) {
      throw new Error(`export is missing the '${key}' row array`);
    }
  }
  return parsed as OdinExport;
}
