DROP INDEX IF EXISTS idx_identity_links_anonymous_id;
DROP INDEX IF EXISTS idx_identity_links_email_hash;

CREATE TABLE IF NOT EXISTS identity_links (
  tenant_id TEXT NOT NULL DEFAULT 'decole',
  profile_id TEXT NOT NULL,
  anonymous_id TEXT,
  email_hash TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, profile_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_links_tenant_profile
ON identity_links(tenant_id, profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_links_tenant_anonymous_id
ON identity_links(tenant_id, anonymous_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_links_tenant_email_hash
ON identity_links(tenant_id, email_hash);
