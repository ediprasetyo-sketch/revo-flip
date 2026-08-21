import Fastify from 'fastify';
import cors from '@fastify/cors';
import statik from '@fastify/static';
import { Pool } from 'pg';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/data';
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 10 * 1024 ** 3);
const MAX_CHUNK_SIZE = 15 * 1024 * 1024;
const SHARE_TTL_HOURS = 24;
const VERSION_FILE = path.join(__dirname, '.revo-flip-version');
const APP_VERSION = (await fs.readFile(VERSION_FILE, 'utf8').catch(() => 'dev')).trim() || 'dev';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not configured');
let database;
try { database = new URL(databaseUrl); } catch { throw new Error('DATABASE_URL is invalid'); }
if (!database.password) throw new Error('DATABASE_URL password is missing');
const pool = new Pool({ connectionString: databaseUrl });
const p = (...x) => path.join(DATA_DIR, ...x);

await Promise.all(['temp', 'books', 'covers', 'thumbnails'].map(x => fs.mkdir(p(x), { recursive: true })));
await pool.query(`CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
)`);
await pool.query('CREATE INDEX IF NOT EXISTS idx_share_links_book_expiry ON share_links(book_id, expires_at)');
await app.register(cors, { origin: true });
await app.register(statik, {
  root: path.join(__dirname, 'public'),
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  }
});

async function q(sql, args = []) { return (await pool.query(sql, args)).rows; }
function safeName(name = 'file.pdf') { return path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_'); }
function parsePartBody(body) {
  if (!body || typeof body !== 'object') throw new Error('Body part tidak valid');
  if (typeof body.data !== 'string' || !body.data) throw new Error('Data chunk kosong');
  const data = Buffer.from(body.data, 'base64');
  if (!data.length) throw new Error('Data chunk kosong');
  return data;
}
function parseRange(header, size) {
  if (!header || !header.startsWith('bytes=')) return null;
  const [startRaw, endRaw] = header.slice(6).split('-');
  let start = startRaw === '' ? NaN : Number(startRaw);
  let end = endRaw === '' ? NaN : Number(endRaw);
  if (!Number.isInteger(start) && !Number.isInteger(end)) return 'invalid';
  if (!Number.isInteger(start)) {
    const suffix = Math.min(end, size);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    if (!Number.isInteger(end) || end >= size) end = size - 1;
  }
  if (start < 0 || start >= size || end < start) return 'invalid';
  return { start, end };
}

await app.register(async function apiRoutes(api) {
  api.get('/api/version', async () => ({ ok: true, version: APP_VERSION, pid: process.pid }));
  api.get('/api/health', async () => ({ ok: true, storage: DATA_DIR, version: APP_VERSION }));
  api.get('/api/books', async () => q('SELECT id,title,original_filename,file_size,status,visibility,created_at FROM books WHERE status=$1 ORDER BY created_at DESC', ['ready']));
  api.get('/api/books/:id', async (req, reply) => {
    const rows = await q('SELECT * FROM books WHERE id=$1', [req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    return rows[0];
  });

  api.post('/api/books/:id/share', async (req, reply) => {
    const rows = await q('SELECT id FROM books WHERE id=$1 AND status=$2', [req.params.id, 'ready']);
    if (!rows[0]) return reply.code(404).send({ error: 'Flipbook tidak ditemukan' });
    await q('DELETE FROM share_links WHERE expires_at <= NOW()');
    const token = crypto.randomBytes(24).toString('base64url');
    const expires = (await q(`INSERT INTO share_links(token,book_id,expires_at)
      VALUES($1,$2,NOW() + ($3 || ' hours')::interval)
      RETURNING expires_at`, [token, req.params.id, SHARE_TTL_HOURS]))[0];
    return { ok: true, token, expiresAt: expires.expires_at, expiresInHours: SHARE_TTL_HOURS, viewer: `/viewer.html?share=${encodeURIComponent(token)}` };
  });

  api.get('/api/share/:token', async (req, reply) => {
    const rows = await q(`SELECT s.book_id,s.expires_at,b.title FROM share_links s JOIN books b ON b.id=s.book_id WHERE s.token=$1 AND s.expires_at > NOW() AND b.status=$2`, [req.params.token, 'ready']);
    if (!rows[0]) return reply.code(410).send({ error: 'Link sudah kedaluwarsa atau tidak valid' });
    await q('UPDATE share_links SET last_used_at=NOW() WHERE token=$1', [req.params.token]);
    return { ok: true, id: rows[0].book_id, title: rows[0].title, expiresAt: rows[0].expires_at };
  });

  api.post('/api/upload/init', async (req, reply) => {
    const { name, size, type, chunkSize } = req.body || {};
    if (type !== 'application/pdf') return reply.code(400).send({ error: 'Hanya PDF' });
    if (!Number.isFinite(size) || size < 1 || size > MAX_FILE_SIZE) return reply.code(400).send({ error: 'Ukuran file tidak valid' });
    const requested = Number(chunkSize) || 10 * 1024 * 1024;
    const actualChunkSize = Math.min(Math.max(requested, 256 * 1024), MAX_CHUNK_SIZE);
    const id = crypto.randomUUID();
    const dir = p('temp', id);
    await fs.mkdir(dir, { recursive: true });
    await q('INSERT INTO uploads(id,original_filename,total_size,chunk_size,status,temp_path) VALUES($1,$2,$3,$4,$5,$6)', [id, safeName(name), size, actualChunkSize, 'uploading', dir]);
    return { uploadId: id, chunkSize: actualChunkSize, maxFileSize: MAX_FILE_SIZE, version: APP_VERSION };
  });

  api.put('/api/upload/part', async (req, reply) => {
    const { uploadId, part } = req.query;
    const n = Number(part);
    if (!uploadId || !Number.isInteger(n) || n < 1) return reply.code(400).send({ error: 'Part tidak valid' });
    const rows = await q('SELECT * FROM uploads WHERE id=$1', [uploadId]);
    const upload = rows[0];
    if (!upload) return reply.code(404).send({ error: 'Upload tidak ditemukan' });
    let body;
    try { body = parsePartBody(req.body); } catch (err) { return reply.code(400).send({ error: err.message }); }
    if (body.length > Number(upload.chunk_size)) return reply.code(413).send({ error: 'Chunk terlalu besar' });
    const out = path.join(upload.temp_path, `part-${String(n).padStart(8, '0')}`);
    await fs.writeFile(out, body);
    await q('INSERT INTO upload_parts(upload_id,part_number,part_size) VALUES($1,$2,$3) ON CONFLICT(upload_id,part_number) DO UPDATE SET part_size=EXCLUDED.part_size', [uploadId, n, body.length]);
    const progress = (await q('SELECT COALESCE(SUM(part_size),0)::bigint AS uploaded FROM upload_parts WHERE upload_id=$1', [uploadId]))[0];
    return { ok: true, uploaded: Number(progress.uploaded), total: Number(upload.total_size), version: APP_VERSION };
  });

  api.get('/api/upload/:id/status', async (req, reply) => {
    const rows = await q('SELECT total_size,chunk_size,status FROM uploads WHERE id=$1', [req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    const parts = await q('SELECT part_number FROM upload_parts WHERE upload_id=$1 ORDER BY part_number', [req.params.id]);
    return { ...rows[0], parts: parts.map(x => x.part_number), version: APP_VERSION };
  });

  api.post('/api/upload/complete', async (req, reply) => {
    const { uploadId, title } = req.body || {};
    const rows = await q('SELECT * FROM uploads WHERE id=$1', [uploadId]);
    const upload = rows[0];
    if (!upload) return reply.code(404).send({ error: 'Upload tidak ditemukan' });
    const parts = await q('SELECT part_number,part_size FROM upload_parts WHERE upload_id=$1 ORDER BY part_number', [uploadId]);
    const total = parts.reduce((sum, item) => sum + Number(item.part_size), 0);
    if (total !== Number(upload.total_size)) return reply.code(409).send({ error: 'Upload belum lengkap', uploaded: total, total: Number(upload.total_size) });
    const bookId = crypto.randomUUID();
    const filename = `${bookId}-${safeName(upload.original_filename)}`;
    const finalPath = p('books', filename);
    const handle = await fs.open(finalPath, 'w');
    try { for (const part of parts) await handle.write(await fs.readFile(path.join(upload.temp_path, `part-${String(part.part_number).padStart(8, '0')}`))); } finally { await handle.close(); }
    await q('INSERT INTO books(id,title,original_filename,storage_path,file_size,mime_type,status) VALUES($1,$2,$3,$4,$5,$6,$7)', [bookId, title || upload.original_filename.replace(/\.pdf$/i, ''), upload.original_filename, finalPath, upload.total_size, 'application/pdf', 'ready']);
    await q('UPDATE uploads SET status=$2,completed_at=NOW() WHERE id=$1', [uploadId, 'completed']);
    await fs.rm(upload.temp_path, { recursive: true, force: true });
    return { ok: true, id: bookId, viewer: `/viewer.html?id=${bookId}`, version: APP_VERSION };
  });

  api.post('/api/upload/:id/abort', async (req) => {
    const rows = await q('SELECT temp_path FROM uploads WHERE id=$1', [req.params.id]);
    if (rows[0]) await fs.rm(rows[0].temp_path, { recursive: true, force: true });
    await q('UPDATE uploads SET status=$2 WHERE id=$1', [req.params.id, 'aborted']);
    return { ok: true };
  });

  api.get('/api/media/:id', async (req, reply) => {
    const token = req.query?.share;
    if (token) {
      const allowed = await q('SELECT book_id FROM share_links WHERE token=$1 AND book_id=$2 AND expires_at > NOW()', [token, req.params.id]);
      if (!allowed[0]) return reply.code(410).send({ error: 'Link sudah kedaluwarsa atau tidak valid' });
    }
    const rows = await q('SELECT storage_path,mime_type FROM books WHERE id=$1 AND status=$2', [req.params.id, 'ready']);
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });

    let info;
    try { info = await fs.stat(rows[0].storage_path); } catch { return reply.code(404).send({ error: 'File PDF tidak ditemukan di storage' }); }
    const size = info.size;
    const range = parseRange(req.headers.range, size);
    reply.header('content-type', rows[0].mime_type || 'application/pdf').header('accept-ranges', 'bytes').header('cache-control', 'no-store');
    if (range === 'invalid') return reply.code(416).header('content-range', `bytes */${size}`).send();
    if (range) {
      const length = range.end - range.start + 1;
      reply.code(206).header('content-range', `bytes ${range.start}-${range.end}/${size}`).header('content-length', length);
      return reply.send(createReadStream(rows[0].storage_path, { start: range.start, end: range.end }));
    }
    reply.header('content-length', size);
    return reply.send(createReadStream(rows[0].storage_path));
  });
});

app.setErrorHandler((err, req, reply) => {
  req.log.error({ err, contentType: req.headers['content-type'], version: APP_VERSION }, 'request failed');
  reply.code(err.statusCode || 500).send({ error: err.message || 'Server error', version: APP_VERSION });
});
app.listen({ port: PORT, host: '0.0.0.0' });
