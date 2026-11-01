import { Buffer } from 'node:buffer';
import { assets } from './assets.js';

const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_REQUEST = MAX_IMAGE + 128 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
};
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...HEADERS, 'Content-Type': 'application/json' } });
const hash = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');

function findURL(text) {
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    try {
      const url = new URL(match[0].replace(/[.,;!?]+$/, ''));
      if (!url.username && !url.password && ['http:', 'https:'].includes(url.protocol)) return url.href;
    } catch { /* keep looking */ }
  }
  return null;
}

function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  const start = Buffer.from(bytes.subarray(0, 12)).toString('ascii');
  if (start.startsWith('GIF87a') || start.startsWith('GIF89a')) return 'image/gif';
  if (start.startsWith('RIFF') && start.slice(8) === 'WEBP') return 'image/webp';
  return null;
}

async function limitedBody(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) throw new HttpError(413, 'Image too large (maximum 10 MB).');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'Upload too large.'); }
    parts.push(value);
  }
  return Buffer.concat(parts, size);
}

async function authenticate(request, env) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-zA-Z0-9_-]{40,100})$/)?.[1];
  if (!token) throw new HttpError(401, 'Connect Paperclip in the app first.');
  const device = await env.DB.prepare('SELECT id FROM devices WHERE token_hash = ? AND revoked_at IS NULL').bind(await hash(token)).first();
  if (!device) throw new HttpError(401, 'Connection expired. Pair this phone again.');
  return device;
}

async function pair(request, env) {
  const data = await limitedBody(request, 2048);
  let body; try { body = JSON.parse(Buffer.from(data).toString()); } catch { throw new HttpError(400, 'Invalid pairing request.'); }
  // 128 random bits, generated through the owner’s authenticated Cloudflare connection.
  const code = String(body.code || '').replace(/[\s-]/g, '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(code)) throw new HttpError(401, 'Pairing code is invalid or expired.');
  const claim = await env.DB.prepare("UPDATE pairing_codes SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE code_hash = ? AND used_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') RETURNING code_hash").bind(await hash(code)).first();
  if (!claim) throw new HttpError(401, 'Pairing code is invalid or expired.');
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  await env.DB.prepare('INSERT INTO devices (id, token_hash, name) VALUES (?, ?, ?)').bind(crypto.randomUUID(), await hash(token), String(body.name || 'Android').slice(0,100)).run();
  return json({ token }, 201);
}

async function capture(request, env) {
  await authenticate(request, env);
  const bytes = await limitedBody(request, MAX_REQUEST);
  let form;
  try { form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('Content-Type') || '' } }).formData(); }
  catch { throw new HttpError(400, 'Expected a multipart share.'); }
  const id = form.get('id');
  if (typeof id !== 'string' || !UUID.test(id)) throw new HttpError(400, 'Missing share ID.');
  if (await env.DB.prepare('SELECT id FROM discarded_items WHERE id = ?').bind(id).first()) throw new HttpError(410, 'Removed from queue.');
  // Retrying a durable local job never creates a duplicate.
  if (await env.DB.prepare('SELECT id FROM items WHERE id = ?').bind(id).first()) return json({ id, saved: true });
  const text = form.get('text') || '', title = form.get('title') || '';
  if (typeof text !== 'string' || text.length > 32000 || typeof title !== 'string' || title.length > 500) throw new HttpError(400, 'Shared text is too long.');
  const file = form.get('file');
  let mime = null, image = null, preview = null;
  if (file && typeof file.arrayBuffer === 'function') {
    if (!file.size || file.size > MAX_IMAGE) throw new HttpError(413, 'Image must be between 1 byte and 10 MB.');
    image = new Uint8Array(await file.arrayBuffer());
    mime = imageType(image);
    if (!mime) throw new HttpError(415, 'Supported images: JPEG, PNG, GIF and WebP.');
    const thumb = form.get('preview');
    if (thumb && typeof thumb.arrayBuffer === 'function' && thumb.size <= 40000) {
      const b = new Uint8Array(await thumb.arrayBuffer());
      if (imageType(b) === 'image/jpeg') preview = Buffer.from(b).toString('base64');
    }
  } else if (file) throw new HttpError(400, 'Invalid image.');
  const url = findURL(text);
  if (!image && !text.trim()) throw new HttpError(400, 'Nothing to save.');
  const statements = [env.DB.prepare('INSERT INTO items (id, kind, shared_text, shared_title, url, mime_type, byte_size, image_preview) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM discarded_items WHERE id = ?)').bind(id, image ? 'image' : url ? 'link' : 'text', text, title, url, mime, image?.byteLength || 0, preview, id)];
  // D1 has a per-value limit: bounded chunks preserve the original image, atomically.
  if (image) for (let offset = 0, part = 0; offset < image.byteLength; offset += 256 * 1024, part++) statements.push(env.DB.prepare('INSERT INTO image_chunks (item_id, part, data) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM items WHERE id = ?)').bind(id, part, Buffer.from(image.subarray(offset, offset + 256 * 1024)).toString('base64'), id));
  try { await env.DB.batch(statements); }
  catch (error) {
    // Two workers may receive the same retry concurrently. The batch rolls back fully.
    if (!await env.DB.prepare('SELECT id FROM items WHERE id = ?').bind(id).first()) throw error;
  }
  if (await env.DB.prepare('SELECT id FROM discarded_items WHERE id = ?').bind(id).first()) throw new HttpError(410, 'Removed from queue.');
  return json({ id, saved: true }, 201);
}

async function waiting(request, env) {
  await authenticate(request, env);
  const [page, count] = await env.DB.batch([
    env.DB.prepare("SELECT id,created_at,kind,url,shared_title,status FROM items WHERE status IN ('pending','held') ORDER BY created_at DESC,id DESC LIMIT 3"),
    env.DB.prepare("SELECT count(*) AS total FROM items WHERE status IN ('pending','held')"),
  ]);
  return json({ items: page.results.map(row => ({ id: row.id, created_at: row.created_at, kind: row.kind, url: row.url?.slice(0,2048) || null, title: row.shared_title || (row.kind === 'image' ? 'Image' : 'Text'), status: row.status })), total: count.results[0].total });
}

async function discard(request, env, id) {
  await authenticate(request, env);
  if (!UUID.test(id)) throw new HttpError(400, 'Invalid queue ID.');
  // Remember removals even if an offline upload arrives later. Publication and
  // removal serialize atomically: this endpoint never deletes published records.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO discarded_items(id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM items WHERE id = ? AND status = 'published') ON CONFLICT(id) DO NOTHING").bind(id,id),
    env.DB.prepare("DELETE FROM items WHERE id = ? AND status IN ('pending','held')").bind(id),
  ]);
  if (!await env.DB.prepare('SELECT id FROM discarded_items WHERE id = ?').bind(id).first()) throw new HttpError(409, 'This item has already been published.');
  return json({ id, removed: true });
}

async function collection(request, env) {
  const search = new URL(request.url).searchParams;
  const query = (search.get('q') || '').slice(0,200).trim().split(/\s+/).filter(Boolean).slice(0,10);
  const category = (search.get('category') || '').slice(0,64);
  const tag = (search.get('tag') || '').slice(0,80);
  const after = search.get('after') || '';
  if (after && !UUID.test(after.split('|')[1] || '')) throw new HttpError(400, 'Invalid cursor.');
  const [date, id] = after.split('|');
  const conditions = ["status = 'published'", "(? = '' OR created_at < ? OR (created_at = ? AND id < ?))", "(? = '' OR category = ?)", "(? = '' OR EXISTS (SELECT 1 FROM json_each(items.tags) WHERE value = ?))", ...query.map(()=>"instr(lower(coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(url,'') || ' ' || tags), lower(?)) > 0")];
  const { results } = await env.DB.prepare(`SELECT id, created_at, kind, url, mime_type, title, summary, category, tags, published_at FROM items WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT 101`).bind(after, date || '', date || '', id || '', category, category, tag, tag, ...query).all();
  const categories = await env.DB.prepare("SELECT DISTINCT category FROM items WHERE status = 'published' AND category IS NOT NULL ORDER BY category").all();
  const page = results.slice(0,100);
  const last = page.at(-1);
  return json({ items: page.map(row => ({ ...row, tags: JSON.parse(row.tags), image_url: row.kind === 'image' ? `/media/${row.id}` : null })), categories: categories.results.map(x=>x.category), next: results.length > 100 ? `${last.created_at}|${last.id}` : null });
}

async function media(id, env) {
  if (!UUID.test(id)) throw new HttpError(404, 'Not found.');
  const item = await env.DB.prepare("SELECT mime_type FROM items WHERE id = ? AND status = 'published' AND kind = 'image'").bind(id).first();
  if (!item) throw new HttpError(404, 'Not found.');
  const { results } = await env.DB.prepare('SELECT data FROM image_chunks WHERE item_id = ? ORDER BY part').bind(id).all();
  const stream = new ReadableStream({ start(controller) { for (const row of results) controller.enqueue(Buffer.from(row.data,'base64')); controller.close(); } });
  return new Response(stream, { headers: { ...HEADERS, 'Content-Type': item.mime_type } });
}

export default {
  async fetch(request, env) {
    try {
      const { pathname } = new URL(request.url);
      if (request.method === 'POST' && pathname === '/api/pair') return await pair(request, env);
      if (request.method === 'POST' && pathname === '/api/capture') return await capture(request, env);
      if (request.method === 'GET' && pathname === '/api/queue') return await waiting(request, env);
      if (request.method === 'DELETE' && pathname.startsWith('/api/queue/')) return await discard(request, env, pathname.slice(11));
      if (request.method === 'GET' && pathname === '/api/device') { await authenticate(request, env); return json({ connected: true }); }
      if (request.method === 'GET' && pathname === '/api/items') return await collection(request, env);
      if (request.method === 'GET' && pathname.startsWith('/media/')) return await media(pathname.slice(7), env);
      if (request.method === 'GET' && pathname === '/api/health') { await env.DB.prepare('SELECT 1').first(); return json({ ok: true }); }
      if (['GET','HEAD'].includes(request.method) && assets[pathname]) {
        const [body, type] = assets[pathname];
        return new Response(request.method === 'HEAD' ? null : body, { headers: { ...HEADERS, 'Content-Type': type } });
      }
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // Never log the private share, pairing code, image bytes or device token.
      console.error(JSON.stringify({ event: 'request_failed', name: error.name }));
      return json({ error: 'Could not save right now. Paperclip will retry.' }, 500);
    }
  },
};
