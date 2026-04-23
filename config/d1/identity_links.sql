CREATE TABLE IF NOT EXISTS identity_links (
  profile_id TEXT PRIMARY KEY,
  anonymous_id TEXT,
  email_hash TEXT,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_links_anonymous_id
ON identity_links(anonymous_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_links_email_hash
ON identity_links(email_hash);
