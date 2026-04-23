CREATE TABLE IF NOT EXISTS funnel_events (
  event_id TEXT PRIMARY KEY,
  profile_id TEXT,
  anonymous_id TEXT,
  email_hash TEXT,
  event_type TEXT NOT NULL,
  product_code TEXT NOT NULL,
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_profile
ON funnel_events(profile_id, occurred_at);
