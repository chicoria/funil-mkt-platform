-- Schema v2: adicionado tenant_id (2026-05-18, Slice 2.11D.1)
-- tenant_id DEFAULT 'decole' preserva todos os dados históricos corretamente.
-- Índice único expandido para incluir tenant_id (isolamento multi-tenant).
CREATE TABLE IF NOT EXISTS meta_daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'decole',
  date TEXT NOT NULL,
  product_code TEXT NOT NULL,
  spend REAL,
  impressions INTEGER,
  link_clicks INTEGER,
  landing_page_views INTEGER,
  leads INTEGER,
  cpm REAL,
  cpc REAL,
  ctr REAL,
  cost_per_lead REAL,
  fetched_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_daily_unique
ON meta_daily_metrics(tenant_id, date, product_code);
