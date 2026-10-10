CREATE TABLE transfers (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  token_hash TEXT UNIQUE,
  email TEXT NOT NULL,
  lang TEXT NOT NULL CHECK (lang IN ('cs', 'en')),
  origin TEXT NOT NULL CHECK (origin IN ('form', 'admin')),
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  link_version INTEGER NOT NULL DEFAULT 0,
  valid_days INTEGER NOT NULL,
  expires_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('open', 'received', 'draft', 'active', 'expired', 'deleted')),
  file_name TEXT,
  file_size INTEGER,
  uploaded_at INTEGER,
  first_download_at INTEGER,
  purged_at INTEGER,
  ended_at INTEGER
);
CREATE INDEX transfers_origin_created ON transfers (origin, created_at);
CREATE INDEX transfers_status ON transfers (status);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  transfer_id TEXT,
  link_version INTEGER,
  detail TEXT
);
CREATE INDEX audit_action_ts ON audit (action, ts);
CREATE INDEX audit_transfer ON audit (transfer_id, action, link_version);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
