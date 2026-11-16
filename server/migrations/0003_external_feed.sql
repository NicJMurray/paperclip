CREATE TABLE IF NOT EXISTS feed_items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  category TEXT NOT NULL,
  media TEXT NOT NULL CHECK (json_valid(media)),
  source_key TEXT NOT NULL,
  UNIQUE(source, source_key)
);
CREATE INDEX IF NOT EXISTS feed_items_source_created ON feed_items(source, created_at, id);
CREATE TABLE IF NOT EXISTS feed_sync (
  source TEXT PRIMARY KEY,
  attempted_at INTEGER NOT NULL,
  etag TEXT,
  url TEXT
);
