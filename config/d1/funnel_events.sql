DROP INDEX IF EXISTS idx_funnel_events_profile;

CREATE TABLE IF NOT EXISTS funnel_events (
  tenant_id TEXT NOT NULL DEFAULT 'decole',
  event_id TEXT NOT NULL,
  profile_id TEXT,
  anonymous_id TEXT,
  email_hash TEXT,
  event_type TEXT NOT NULL,
  product_code TEXT NOT NULL,
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, event_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_funnel_events_tenant_event_id
ON funnel_events(tenant_id, event_id);

CREATE INDEX IF NOT EXISTS idx_funnel_events_tenant_profile
ON funnel_events(tenant_id, profile_id, occurred_at);
