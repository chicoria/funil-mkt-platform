CREATE TABLE IF NOT EXISTS session_engagement (
  tenant_id        TEXT NOT NULL DEFAULT 'decole',
  session_id       TEXT NOT NULL,
  anonymous_id     TEXT,
  profile_id       TEXT,
  product_code     TEXT NOT NULL,
  funnel_stage     TEXT,
  first_seen_at    TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL,
  page_views       INTEGER DEFAULT 0,
  max_scroll_pct   INTEGER DEFAULT 0,
  lp_sections_viewed   TEXT,
  lp_sections_engaged  TEXT,
  cta_clicks       TEXT,
  vsl_version      TEXT,
  vsl_max_pct      INTEGER DEFAULT 0,
  vsl_sections     TEXT,
  became_lead      INTEGER DEFAULT 0,
  purchased        INTEGER DEFAULT 0,
  PRIMARY KEY (tenant_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_se_tenant_profile ON session_engagement(tenant_id, profile_id);
CREATE INDEX IF NOT EXISTS idx_se_tenant_anon    ON session_engagement(tenant_id, anonymous_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_se_tenant_product_stage ON session_engagement(tenant_id, product_code, funnel_stage, last_seen_at);
