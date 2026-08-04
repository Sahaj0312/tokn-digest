CREATE TABLE IF NOT EXISTS digest_documents (
  path TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recent_articles (
  article_id TEXT PRIMARY KEY,
  article_url TEXT NOT NULL,
  title TEXT NOT NULL,
  digest_date TEXT NOT NULL,
  published_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recent_articles_expires_at
ON recent_articles(expires_at);
