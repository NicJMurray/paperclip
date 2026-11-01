CREATE TABLE IF NOT EXISTS discarded_items (
  id TEXT PRIMARY KEY,
  discarded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
