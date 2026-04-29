CREATE TABLE IF NOT EXISTS meta_daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
ON meta_daily_metrics(date, product_code);
