-- Schema v2: adicionado tenant_id (2026-05-18, Slice 2.11D.1)
-- tenant_id DEFAULT 'decole' preserva todos os dados históricos corretamente.
-- Índice único expandido para incluir tenant_id (isolamento multi-tenant).
CREATE TABLE IF NOT EXISTS ga4_daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'decole',
  date TEXT NOT NULL,
  product_code TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ga4_daily_unique
ON ga4_daily_metrics(tenant_id, date, product_code, event_name);
