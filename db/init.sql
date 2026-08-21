CREATE TABLE IF NOT EXISTS books (
 id UUID PRIMARY KEY,
 title TEXT NOT NULL,
 original_filename TEXT NOT NULL,
 storage_path TEXT NOT NULL,
 file_size BIGINT NOT NULL,
 mime_type TEXT NOT NULL DEFAULT 'application/pdf',
 status TEXT NOT NULL DEFAULT 'processing',
 visibility TEXT NOT NULL DEFAULT 'public',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS uploads (
 id UUID PRIMARY KEY,
 original_filename TEXT NOT NULL,
 total_size BIGINT NOT NULL,
 chunk_size BIGINT NOT NULL,
 status TEXT NOT NULL,
 temp_path TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS upload_parts (
 upload_id UUID REFERENCES uploads(id) ON DELETE CASCADE,
 part_number INTEGER NOT NULL,
 part_size BIGINT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(upload_id,part_number)
);
CREATE TABLE IF NOT EXISTS share_links (
 token TEXT PRIMARY KEY,
 book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_books_status_created ON books(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
CREATE INDEX IF NOT EXISTS idx_share_links_book_expiry ON share_links(book_id,expires_at);
