CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('master','user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_bases (
  key TEXT PRIMARY KEY,
  rows JSONB NOT NULL,
  file_name TEXT,
  source_sheet TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS app_bases_updated_at_idx ON app_bases(updated_at);
