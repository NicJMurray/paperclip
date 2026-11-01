CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  kind TEXT NOT NULL CHECK (kind IN ('link','text','image')),
  shared_text TEXT NOT NULL DEFAULT '',
  shared_title TEXT NOT NULL DEFAULT '',
  url TEXT,
  mime_type TEXT,
  byte_size INTEGER NOT NULL DEFAULT 0,
  image_preview TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','held')),
  title TEXT,
  summary TEXT,
  category TEXT,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  published_at TEXT,
  review_note TEXT
);
CREATE INDEX IF NOT EXISTS items_status_created ON items(status, created_at, id);
CREATE TABLE IF NOT EXISTS image_chunks (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(item_id, part)
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS pairing_codes (
  code_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS curation_runs (
  id TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL,
  published_count INTEGER NOT NULL DEFAULT 0,
  held_count INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
