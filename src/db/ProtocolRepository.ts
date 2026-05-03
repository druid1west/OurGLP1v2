import { getDb } from '../db/sqlite';
import type { ProtocolKind } from '../lib/protocolCatalog';

export type Protocol = {
  id: number;
  user_id: string;
  kind: ProtocolKind;
  name: string;
  dose_label: string | null;
  cadence_label: string | null;
  route_label: string | null;
  tracking_focus: string[];
  notes: string | null;
  is_active: boolean;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
};

export type ProtocolEvent = {
  id: number;
  protocol_id: number;
  user_id: string;
  event_at: string;
  dose_label: string | null;
  notes: string | null;
  created_at: string;
};

export type CreateProtocolInput = {
  userId: string;
  kind: ProtocolKind;
  name: string;
  doseLabel?: string | null;
  cadenceLabel?: string | null;
  routeLabel?: string | null;
  trackingFocus?: string[];
  notes?: string | null;
  isPrimary?: boolean;
};

type QueryRow = Record<string, unknown>;
type QueryResult = { values?: unknown[] } | null | undefined;

function rows(result: QueryResult): QueryRow[] {
  const values = result?.values;
  if (!values || values.length === 0) return [];

  if (Array.isArray(values[0]) && values.length >= 2 && Array.isArray(values[1])) {
    const cols = values[0] as string[];
    return (values.slice(1) as unknown[][]).map((arr) => {
      const row: QueryRow = {};
      cols.forEach((col, index) => {
        row[col] = arr[index];
      });
      return row;
    });
  }

  if (
    typeof values[0] === 'object' &&
    values[0] !== null &&
    'ios_columns' in (values[0] as QueryRow)
  ) {
    const cols = (values[0] as { ios_columns: string[] }).ios_columns;
    return values
      .slice(1)
      .filter((row): row is QueryRow => typeof row === 'object' && row !== null && !Array.isArray(row))
      .map((rowObj) => {
        const row: QueryRow = {};
        cols.forEach((col) => {
          row[col] = Object.prototype.hasOwnProperty.call(rowObj, col) ? rowObj[col] : undefined;
        });
        return row;
      });
  }

  return values.filter(
    (row): row is QueryRow => typeof row === 'object' && row !== null && !Array.isArray(row)
  );
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseFocus(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function mapProtocol(row: QueryRow): Protocol {
  return {
    id: num(row.id),
    user_id: str(row.user_id) ?? '',
    kind: (str(row.kind) ?? 'custom') as ProtocolKind,
    name: str(row.name) ?? 'Custom protocol',
    dose_label: str(row.dose_label),
    cadence_label: str(row.cadence_label),
    route_label: str(row.route_label),
    tracking_focus: parseFocus(row.tracking_focus_json),
    notes: str(row.notes),
    is_active: num(row.is_active) === 1,
    is_primary: num(row.is_primary) === 1,
    created_at: str(row.created_at) ?? new Date().toISOString(),
    updated_at: str(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapEvent(row: QueryRow): ProtocolEvent {
  return {
    id: num(row.id),
    protocol_id: num(row.protocol_id),
    user_id: str(row.user_id) ?? '',
    event_at: str(row.event_at) ?? new Date().toISOString(),
    dose_label: str(row.dose_label),
    notes: str(row.notes),
    created_at: str(row.created_at) ?? new Date().toISOString(),
  };
}

export async function initProtocolTables(): Promise<void> {
  const db = await getDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS protocols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'custom',
      name TEXT NOT NULL,
      dose_label TEXT,
      cadence_label TEXT,
      route_label TEXT,
      tracking_focus_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_protocols_user_active
      ON protocols (user_id, is_active, is_primary);
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS protocol_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      protocol_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      event_at TEXT NOT NULL,
      dose_label TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_protocol_events_user_day
      ON protocol_events (user_id, event_at);
  `);
}

export async function listProtocols(userId: string): Promise<Protocol[]> {
  await initProtocolTables();
  const db = await getDb();
  const result = await db.query(
    `
    SELECT *
    FROM protocols
    WHERE user_id = ?
    ORDER BY is_active DESC, is_primary DESC, datetime(updated_at) DESC, id DESC
    `,
    [userId]
  );
  return rows(result).map(mapProtocol);
}

export async function createProtocol(input: CreateProtocolInput): Promise<void> {
  await initProtocolTables();
  const db = await getDb();
  const focus = JSON.stringify(input.trackingFocus ?? []);
  const now = new Date().toISOString();

  if (input.isPrimary) {
    await db.run(`UPDATE protocols SET is_primary = 0, updated_at = ? WHERE user_id = ?`, [
      now,
      input.userId,
    ]);
  }

  await db.run(
    `
    INSERT INTO protocols (
      user_id, kind, name, dose_label, cadence_label, route_label,
      tracking_focus_json, notes, is_active, is_primary, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `,
    [
      input.userId,
      input.kind,
      input.name.trim(),
      input.doseLabel?.trim() || null,
      input.cadenceLabel?.trim() || null,
      input.routeLabel?.trim() || null,
      focus,
      input.notes?.trim() || null,
      input.isPrimary ? 1 : 0,
      now,
      now,
    ]
  );
}

export async function setProtocolActive(protocolId: number, active: boolean): Promise<void> {
  await initProtocolTables();
  const db = await getDb();
  await db.run(
    `UPDATE protocols SET is_active = ?, updated_at = ? WHERE id = ?`,
    [active ? 1 : 0, new Date().toISOString(), protocolId]
  );
}

export async function logProtocolEvent(
  protocol: Pick<Protocol, 'id' | 'user_id' | 'dose_label'>,
  notes?: string | null
): Promise<void> {
  await initProtocolTables();
  const db = await getDb();
  await db.run(
    `
    INSERT INTO protocol_events (protocol_id, user_id, event_at, dose_label, notes)
    VALUES (?, ?, ?, ?, ?)
    `,
    [
      protocol.id,
      protocol.user_id,
      new Date().toISOString(),
      protocol.dose_label ?? null,
      notes?.trim() || null,
    ]
  );
}

export async function listProtocolEventsForDay(
  userId: string,
  day: string
): Promise<ProtocolEvent[]> {
  await initProtocolTables();
  const db = await getDb();
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const result = await db.query(
    `
    SELECT *
    FROM protocol_events
    WHERE user_id = ?
      AND datetime(event_at) >= datetime(?)
      AND datetime(event_at) < datetime(?)
    ORDER BY datetime(event_at) DESC, id DESC
    `,
    [userId, start.toISOString(), end.toISOString()]
  );
  return rows(result).map(mapEvent);
}
