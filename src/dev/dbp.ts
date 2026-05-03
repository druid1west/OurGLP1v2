// src/dev/dbp.ts
import { listHealthLogsRange, upsertDailyProtein } from '../db/HealthRepository';
import { logger } from '../utils/logger';

type Row = Record<string, unknown>;
type Values = ReadonlyArray<string | number | null>;

type QueryFn = (database: string, statement: string, values?: Values) => Promise<Row[]>;
type RunFn = (database: string, statement: string, values?: Values) => Promise<void>;

// ---- small helpers (typed) ----
function tryNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && Number.isFinite(+v)) return +v;
  return null;
}
function gramsFromJson(dataJson: unknown): number {
  try {
    const obj =
      typeof dataJson === 'string'
        ? (JSON.parse(dataJson) as Record<string, unknown>)
        : (dataJson as Record<string, unknown> | null);
    if (!obj) return 0;
    return tryNum(obj.grams) ?? tryNum(obj.amount) ?? tryNum(obj.value) ?? 0;
  } catch {
    return 0;
  }
}
function toLocalDateOnly(isoLike: string): string {
  const d = new Date(isoLike);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function detectDb(query: QueryFn): Promise<string> {
  const candidates = ['ourglp1', 'app', 'main', 'local', 'health', 'tracker'];
  for (const name of candidates) {
    try {
      const t = await query(
        name,
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('health_logs','daily_protein_intake')"
      );
      const names = (t || []).map(r => String((r as { name?: unknown }).name ?? ''));
      if (names.includes('health_logs')) return name;
    } catch {
      /* keep searching */
    }
  }
  return 'ourglp1';
}

async function detectUserId(query: QueryFn, db: string): Promise<string> {
  // Prefer the mirrored auth (we also wait briefly for hydration)
  const tryGet = (): string | null => {
    const id =
     
      window.__AUTH?.user?.id ??
     
      window.__APP_USER?.id ??
     
      window.__USER?.id ??
      null;
    return id ?? null;
  };

  let id = tryGet();
  if (!id) {
    const start = Date.now();
    while (!id && Date.now() - start < 1500) {
      await new Promise(r => setTimeout(r, 100));
      id = tryGet();
    }
  }
  if (id) return String(id);

  // Fallback: read a users table if present
  try {
    const t = await query(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
    if (t.length) {
      const u = await query(db, 'SELECT id FROM users LIMIT 1');
      const found = (u?.[0] as { id?: unknown })?.id;
      if (typeof found === 'string' || typeof found === 'number') return String(found);
    }
  } catch {
    /* ignore */
  }

  // Last resort prompt (should rarely trigger now)
 
  const manual = window.prompt('Enter user id to use for daily_protein_intake upserts:');
  if (!manual) throw new Error('No user id provided.');
  return String(manual);
}

function getCapacitorFns():
  | { query: QueryFn; run: RunFn; kind: 'capacitor' }
  | undefined {
  
  const plugin = window.Capacitor?.Plugins?.CapacitorSQLite;
  if (!plugin) return undefined;

  const query: QueryFn = async (database, statement, values = []) => {
    const res = await plugin.query({ database, statement, values });
    return res.values ?? [];
  };
  const run: RunFn = async (database, statement, values = []) => {
    await plugin.run({ database, statement, values });
  };
  return { query, run, kind: 'capacitor' };
}

export function initDbp(): void {
  const cap = getCapacitorFns();

  async function printOverview(): Promise<void> {
    if (cap) {
      const DB = await detectDb(cap.query);
      const UID = await detectUserId(cap.query, DB);

      const raw = await cap.query(
        DB,
        `
        SELECT id, entry_type, recorded_at, data_json
        FROM health_logs
        WHERE lower(entry_type)='protein'
        ORDER BY datetime(recorded_at) DESC
        LIMIT ?
      `,
        [50]
      );

      const byDay = await cap.query(
        DB,
        `
        SELECT
          date(datetime(recorded_at,'localtime')) AS d_local,
          SUM(
            COALESCE(
              json_extract(data_json,'$.grams'),
              json_extract(data_json,'$.amount'),
              json_extract(data_json,'$.value'),
              0
            )
          ) AS grams
        FROM health_logs
        WHERE lower(entry_type)='protein'
        GROUP BY d_local
        ORDER BY d_local DESC
        LIMIT ?
      `,
        [14]
      );

      const waterByDay = await cap.query(
        DB,
        `
        SELECT
          date(datetime(recorded_at,'localtime')) AS d_local,
          SUM(
            COALESCE(
              json_extract(data_json,'$.ml'),
              json_extract(data_json,'$.amount'),
              json_extract(data_json,'$.value'),
              0
            )
          ) AS ml
        FROM health_logs
        WHERE lower(entry_type) IN ('hydration','water')
        GROUP BY d_local
        ORDER BY d_local DESC
        LIMIT ?
      `,
        [14]
      );

      const summary = await cap.query(
        DB,
        `
        SELECT user_id, date, protein_grams
        FROM daily_protein_intake
        WHERE user_id=?
        ORDER BY date DESC
        LIMIT ?
      `,
        [UID, 30]
      );

      // Replace console.* with scrubbed logger.*
      logger.info('Raw protein logs (top 50)', raw.map(r => ({
        id: (r as { id?: unknown }).id,
        recorded_at: (r as { recorded_at?: unknown }).recorded_at,
        local_day: typeof (r as { recorded_at?: unknown }).recorded_at === 'string'
          ? toLocalDateOnly(String((r as { recorded_at?: unknown }).recorded_at))
          : '',
        grams: gramsFromJson((r as { data_json?: unknown }).data_json),
      })));

      logger.info('Per-day protein sums from logs (local days, last 14)', byDay);
      logger.info('daily_protein_intake (current user, last 30)', summary);
      logger.info('Hydration per-day sums from logs (local days, last 14)', waterByDay);
    } else {
      // Web fallback (no Capacitor): show today & allow repairs via repo
      const today = new Date().toISOString().slice(0, 10);
      const rows = await listHealthLogsRange(`${today}T00:00:00.000Z`, `${today}T23:59:59.999Z`);
      const todayTotal = rows
        .filter(r => String((r as { entry_type?: unknown }).entry_type).toLowerCase() === 'protein')
        .reduce((sum, r) => sum + gramsFromJson((r as { data?: unknown }).data), 0);

      logger.info('CapacitorSQLite not available; repository-based overview', [
        { day: today, grams: todayTotal }
      ]);
    }
  }

  async function repairDay(dateStr: string): Promise<number> {
    const rows = await listHealthLogsRange(`${dateStr}T00:00:00.000Z`, `${dateStr}T23:59:59.999Z`);
    const total = rows
      .filter(r => String((r as { entry_type?: unknown }).entry_type).toLowerCase() === 'protein')
      .reduce((sum, r) => sum + gramsFromJson((r as { data?: unknown }).data), 0);

    // Upsert using repository (it should resolve current user internally)
    await upsertDailyProtein(undefined as unknown as string, dateStr, total);
    window.dispatchEvent(new Event('protein:changed'));
    logger.info('[repairDay] upserted', { date: dateStr, total, path: 'repo-fallback' });
    return total;
  }

  async function repairRange(lastNDays = 14): Promise<void> {
    const now = new Date();
    for (let i = 0; i < lastNDays; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      await repairDay(dateStr);
    }
    logger.info('[repairRange] completed', { lastNDays, path: 'repo-fallback' });
  }

  async function findStuck(): Promise<void> {
    if (!cap) {
      logger.warn('findStuck: CapacitorSQLite not available in web.');
      return;
    }
    const DB = await detectDb(cap.query);
    const UID = await detectUserId(cap.query, DB);
    const fromLogs = await cap.query(
      DB,
      `
      SELECT date(datetime(recorded_at,'localtime')) AS d_local,
             SUM(COALESCE(json_extract(data_json,'$.grams'),
                          json_extract(data_json,'$.amount'),
                          json_extract(data_json,'$.value'),0)) AS grams
      FROM health_logs
      WHERE lower(entry_type)='protein'
      GROUP BY d_local
      ORDER BY d_local DESC
      LIMIT 21
    `
    );
    const fromTable = await cap.query(
      DB,
      `
      SELECT date, protein_grams
      FROM daily_protein_intake
      WHERE user_id = ?
      ORDER BY date DESC
      LIMIT 30
    `,
      [UID]
    );
    const map = new Map<string, number>();
    fromLogs.forEach(r => map.set(String((r as { d_local?: unknown }).d_local), Number((r as { grams?: unknown }).grams ?? 0)));
    const mismatches = fromTable
      .map(r => {
        const d = String((r as { date?: unknown }).date);
        const s = Number((r as { protein_grams?: unknown }).protein_grams ?? 0);
        const l = map.get(d);
        return l == null ? null : Math.round(l) === Math.round(s) ? null : { date: d, summary: s, logs: l };
      })
      .filter(Boolean) as Array<{ date: string; summary: number; logs: number }>;

    logger.info('Protein mismatches (logs vs summary)', mismatches);
  }

  // Expose once
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).dbp = { printOverview, repairDay, repairRange, findStuck };

  // Styled banner becomes a plain info line (keeps lint happy, still discoverable)
  logger.info(
    'dbp ready → dbp.printOverview(), dbp.repairDay("YYYY-MM-DD"), dbp.repairRange(N), dbp.findStuck()'
  );
}
