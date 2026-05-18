import type { D1Database } from "@cloudflare/workers-types";
import bundledCatalogJson from "../../../config/products.catalog.json";
import type { DashboardSyncEnv, SyncPart, SyncRunRow } from "./types";
import { runSync, resolveTenantList } from "./sync-runner";

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function ensureSyncControlSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS dashboard_sync_runs (
         run_id TEXT PRIMARY KEY,
         date TEXT NOT NULL,
         part TEXT NOT NULL,
         status TEXT NOT NULL,
         started_at TEXT NOT NULL,
         finished_at TEXT,
         error TEXT
       )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS dashboard_sync_control (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`
    )
    .run();
}

/**
 * Idempotent migration: adds tenant_id to ga4_daily_metrics and
 * meta_daily_metrics. Slice 2.11D.1 — 2026-05-18.
 */
async function applyDashboardMigrationsOnce(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS __funilmkt_schema_migrations (
         id TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL
       )`
    )
    .run();

  const MIGRATION_ID = "dashboard_sync_v1_tenant_id_2026_05_18";
  const row = await db
    .prepare(`SELECT id FROM __funilmkt_schema_migrations WHERE id = ? LIMIT 1`)
    .bind(MIGRATION_ID)
    .first<{ id?: string }>();
  if (row?.id) return;

  const now = new Date().toISOString();
  await db.prepare(`ALTER TABLE ga4_daily_metrics ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'decole'`).run();
  await db.prepare(`ALTER TABLE meta_daily_metrics ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'decole'`).run();
  await db.prepare(`DROP INDEX IF EXISTS idx_ga4_daily_unique`).run();
  await db.prepare(`CREATE UNIQUE INDEX idx_ga4_daily_unique ON ga4_daily_metrics(tenant_id, date, product_code, event_name)`).run();
  await db.prepare(`DROP INDEX IF EXISTS idx_meta_daily_unique`).run();
  await db.prepare(`CREATE UNIQUE INDEX idx_meta_daily_unique ON meta_daily_metrics(tenant_id, date, product_code)`).run();
  await db.prepare(`INSERT INTO __funilmkt_schema_migrations (id, applied_at) VALUES (?, ?)`).bind(MIGRATION_ID, now).run();

  console.log(JSON.stringify({ stage: "migration_applied", migration: MIGRATION_ID, applied_at: now }));
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(request: Request, env: DashboardSyncEnv, url: URL): boolean {
  if (url.searchParams.get("secret") === env.SYNC_SECRET) return true;
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === env.SYNC_SECRET) return true;
  return (request.headers.get("x-sync-secret") || "") === env.SYNC_SECRET;
}

// ── Locking ───────────────────────────────────────────────────────────────────

async function tryAcquireLock(db: D1Database): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO dashboard_sync_control (key, value, updated_at)
       VALUES ('sync_lock', '1', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
       WHERE dashboard_sync_control.value != '1'`
    )
    .bind(new Date().toISOString())
    .run();
  return Number(result.meta?.changes || 0) > 0;
}

async function releaseLock(db: D1Database): Promise<void> {
  await db
    .prepare(
      `INSERT INTO dashboard_sync_control (key, value, updated_at)
       VALUES ('sync_lock', '0', ?)
       ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = excluded.updated_at`
    )
    .bind(new Date().toISOString())
    .run();
}

// ── Run records ───────────────────────────────────────────────────────────────

async function saveRunStart(db: D1Database, runId: string, date: string, part: SyncPart): Promise<void> {
  await db
    .prepare(
      `INSERT INTO dashboard_sync_runs (run_id, date, part, status, started_at, finished_at, error)
       VALUES (?, ?, ?, 'running', ?, NULL, NULL)`
    )
    .bind(runId, date, part, new Date().toISOString())
    .run();
}

async function saveRunFinish(db: D1Database, runId: string, ok: boolean, error: string | null): Promise<void> {
  await db
    .prepare(`UPDATE dashboard_sync_runs SET status = ?, finished_at = ?, error = ? WHERE run_id = ?`)
    .bind(ok ? "ok" : "error", new Date().toISOString(), error, runId)
    .run();
}

async function getLatestRun(db: D1Database): Promise<SyncRunRow | null> {
  const row = await db
    .prepare(
      `SELECT run_id, date, part, status, started_at, finished_at, error
       FROM dashboard_sync_runs ORDER BY started_at DESC LIMIT 1`
    )
    .first<SyncRunRow>();
  return row || null;
}

// ── Request parsing ───────────────────────────────────────────────────────────

function resolveDateStr(input: string | null): string {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function resolveSyncPart(input: string | null): SyncPart {
  const raw = (input || "all").toLowerCase();
  if (raw === "ga4" || raw === "meta" || raw === "all") return raw;
  return "all";
}

function asJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

// ── Worker entry ──────────────────────────────────────────────────────────────

export default {
  async scheduled(_event: ScheduledEvent, env: DashboardSyncEnv, ctx: ExecutionContext): Promise<void> {
    await ensureSyncControlSchema(env.EVENT_STORE_DB);
    await applyDashboardMigrationsOnce(env.EVENT_STORE_DB);
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    ctx.waitUntil(
      runSync(env.EVENT_STORE_DB, bundledCatalogJson, env, yesterday.toISOString().slice(0, 10), "all")
        .then((result) => {
          if (result.errors.length > 0) throw new Error(result.errors.join(" | "));
        })
    );
  },

  async fetch(request: Request, env: DashboardSyncEnv): Promise<Response> {
    const url = new URL(request.url);
    await ensureSyncControlSchema(env.EVENT_STORE_DB);
    await applyDashboardMigrationsOnce(env.EVENT_STORE_DB);

    if (url.pathname === "/sync/status") {
      if (!isAuthorized(request, env, url)) return new Response("Unauthorized", { status: 401 });
      return asJson({ ok: true, latest: await getLatestRun(env.EVENT_STORE_DB) });
    }

    if (url.pathname !== "/sync" && url.pathname !== "/sync/run") {
      return new Response("decole-dashboard-sync worker", { status: 200 });
    }

    if (!isAuthorized(request, env, url)) return new Response("Unauthorized", { status: 401 });

    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let dateStr = resolveDateStr(url.searchParams.get("date"));
    let part = resolveSyncPart(url.searchParams.get("part"));
    const tenantFilter = url.searchParams.get("tenant") ?? undefined;

    // Validate tenant filter before acquiring the lock
    if (tenantFilter) {
      try {
        resolveTenantList(bundledCatalogJson, tenantFilter);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return asJson({ ok: false, error: `unknown_tenant:${tenantFilter}`, detail: msg }, 400);
      }
    }

    if (request.method === "POST") {
      try {
        const body = (await request.json()) as { date?: string; part?: string };
        if (body.part) part = resolveSyncPart(body.part);
        if (body.date) dateStr = resolveDateStr(body.date);
      } catch {
        // keep query/default values if body is missing or invalid JSON
      }
    }

    const lock = await tryAcquireLock(env.EVENT_STORE_DB);
    if (!lock) {
      return asJson({ ok: false, error: "sync_already_running", latest: await getLatestRun(env.EVENT_STORE_DB) }, 409);
    }

    const runId = `sync-${Date.now()}`;
    try {
      await saveRunStart(env.EVENT_STORE_DB, runId, dateStr, part);
      const result = await runSync(env.EVENT_STORE_DB, bundledCatalogJson, env, dateStr, part, tenantFilter);

      const onlyGa4Failed =
        part === "all" &&
        result.metaOk &&
        !result.ga4Ok &&
        result.errors.length > 0 &&
        result.errors.every((e) => e.startsWith("ga4:"));

      if (result.errors.length === 0 || onlyGa4Failed) {
        const warning = onlyGa4Failed ? result.errors.join(" | ") : null;
        await saveRunFinish(env.EVENT_STORE_DB, runId, true, warning);
        await releaseLock(env.EVENT_STORE_DB);
        return asJson({ ok: true, partial: onlyGa4Failed || undefined, warning: warning || undefined, run_id: runId, date: dateStr, part });
      }

      const errorMsg = result.errors.join(" | ");
      await saveRunFinish(env.EVENT_STORE_DB, runId, false, errorMsg);
      await releaseLock(env.EVENT_STORE_DB);
      return asJson({ ok: false, run_id: runId, date: dateStr, part, error: errorMsg }, 500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await saveRunFinish(env.EVENT_STORE_DB, runId, false, msg);
      await releaseLock(env.EVENT_STORE_DB);
      return asJson({ ok: false, run_id: runId, date: dateStr, part, error: msg }, 500);
    }
  },
};
