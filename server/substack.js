export const SUBSTACK_PROFILE = 'https://substack.com/@nicjm';
const FEED_LIMIT = 1024 * 1024;
const SYNC_INTERVAL = 60 * 60 * 1000;

function secureURL(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
  } catch {
    return null;
  }
}

function feedDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function originalLink(value, type) {
  const url = secureURL(value);
  if (!url) return null;
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  const sharedPost = url.hostname === 'open.substack.com' && url.pathname.match(/^\/pub\/([a-z0-9-]+)(\/p\/[^/]+)$/i);
  if (sharedPost) {
    url.hostname = sharedPost[1] + '.substack.com';
    url.pathname = sharedPost[2];
  }
  const note = ['substack.com', 'open.substack.com'].includes(url.hostname) &&
    url.pathname.match(/^\/(?:@[^/]+\/|profile\/[^/]+\/)?note\/(c-\d+)$/);
  if (type === 'note' && note) {
    url.hostname = 'substack.com';
    return { url: url.href, key: 'note:' + note[1] };
  }
  if (type !== 'post' || !/^\/p\/[^/]+$/.test(url.pathname)) return null;
  return { url: url.href, key: url.href };
}

export function sharedSubstackLink(value) {
  const url = secureURL(value);
  if (!url || (url.hostname !== 'substack.com' && !url.hostname.endsWith('.substack.com'))) return null;
  const note = originalLink(value, 'note');
  if (note) return { url: note.url, attribute: 'data-comment-link' };
  const post = originalLink(value, 'post');
  if (!post || url.hostname === 'open.substack.com' && !url.pathname.startsWith('/pub/')) return null;
  return { url: post.url, attribute: 'data-post-link' };
}

const IMAGE_HOSTS = ['substackcdn.com', 'substack-post-media.s3.amazonaws.com', 'substack-video.s3.amazonaws.com', 'image.mux.com'];
const VIDEO_HOSTS = ['substackcdn.com', 'substack-video.s3.amazonaws.com', 'stream.mux.com'];

function originalImage(value) {
  const url = secureURL(value);
  return url && IMAGE_HOSTS.includes(url.hostname) ? url.href : null;
}

function originalMedia(value) {
  if (!Array.isArray(value)) return [];
  const media = [];
  const seen = new Set();
  for (const item of value) {
    const url = secureURL(item?.url);
    if (!url || seen.has(url.href)) continue;
    const imageHost = IMAGE_HOSTS.includes(url.hostname);
    const videoHost = VIDEO_HOSTS.includes(url.hostname);
    const mp4 = item.type === 'video' && videoHost && /\.mp4$/i.test(url.pathname);
    const hls = item.type === 'video' && videoHost && /\.m3u8$/i.test(url.pathname);
    if (!(item.type === 'image' && imageHost) && !mp4 && !hls) continue;
    seen.add(url.href);
    media.push({
      type: item.type,
      url: url.href,
      format: hls ? 'hls' : null,
      poster: item.type === 'video' ? originalImage(item.poster) : null,
      portrait: Number.isFinite(item.width) && Number.isFinite(item.height) && item.width > 0 && item.height > item.width,
      alt: typeof item.alt === 'string' ? item.alt : '',
      caption: typeof item.caption === 'string' ? item.caption : '',
    });
    if (media.length === 6) break;
  }
  return media;
}

export async function normalizeSubstackFeed(feed) {
  if (feed?.profile !== SUBSTACK_PROFILE || feed.complete !== true || !Array.isArray(feed.items)) {
    throw new Error('Invalid Substack snapshot');
  }
  const items = new Map();
  for (const entry of feed.items) {
    if (entry?.public === false) continue;
    if (entry?.public !== true) throw new Error('Substack item has no public visibility flag');
    const link = originalLink(entry.url, entry.type);
    const date = feedDate(entry.liked_at) || feedDate(entry.published_at);
    if (!link || !date) throw new Error('Public Substack item has no valid link or date');
    const media = originalMedia(entry.media);
    const category = entry.video === true || media.some(item => item.type === 'video') ? 'videos'
      : entry.type === 'post' ? 'articles' : media.length ? 'images' : 'notes';
    const existing = items.get(link.key);
    if (existing && existing.date >= date) continue;
    items.set(link.key, {
      url: link.url, date, category, media,
      title: typeof entry.title === 'string' ? entry.title : null,
      summary: typeof entry.summary === 'string' ? entry.summary : null,
      key: link.key,
    });
  }
  return Promise.all(Array.from(items.values(), async item => {
    const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('substack:' + item.key));
    const key = Array.from(new Uint8Array(keyBytes).slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
    const id = [key.slice(0, 8), key.slice(8, 12), key.slice(12, 16), key.slice(16, 20), key.slice(20)].join('-');
    return { id, ...item };
  }));
}

export function substackFeedURL(env) {
  return secureURL(env.SUBSTACK_LIKES_URL);
}

export async function refreshSubstack(env, url, fetchFeed = fetch, now = Date.now()) {
  const lease = await env.DB.prepare(
    "INSERT INTO feed_sync (source, attempted_at) VALUES ('substack', ?) " +
    "ON CONFLICT(source) DO UPDATE SET attempted_at = excluded.attempted_at " +
    "WHERE feed_sync.attempted_at <= ? RETURNING etag, url"
  ).bind(now, now - SYNC_INTERVAL).first();
  if (!lease) return;

  const headers = new Headers({ Accept: 'application/json' });
  if (env.SUBSTACK_LIKES_TOKEN) headers.set('Authorization', 'Bearer ' + env.SUBSTACK_LIKES_TOKEN);
  if (lease.etag && lease.url === url.href) headers.set('If-None-Match', lease.etag);
  const response = await fetchFeed(url, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (response.status === 304 && headers.has('If-None-Match')) return;
  if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
    throw new Error('Substack snapshot unavailable');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty Substack snapshot');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let length = 0;
  let content = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > FEED_LIMIT) {
      await reader.cancel();
      throw new Error('Substack snapshot exceeds size limit');
    }
    content += decoder.decode(value, { stream: true });
  }

  const snapshot = JSON.stringify(await normalizeSubstackFeed(JSON.parse(content + decoder.decode())));
  if (new TextEncoder().encode(snapshot).byteLength > FEED_LIMIT) throw new Error('Normalized snapshot exceeds size limit');
  const statements = [
    env.DB.prepare("DELETE FROM feed_items WHERE source = 'substack' AND id NOT IN (SELECT value ->> '$.id' FROM json_each(?))").bind(snapshot),
    env.DB.prepare(
      "INSERT INTO feed_items (id, source, url, created_at, title, summary, category, media, source_key) " +
      "SELECT value ->> '$.id', 'substack', value ->> '$.url', value ->> '$.date', value ->> '$.title', " +
      "value ->> '$.summary', value ->> '$.category', value ->> '$.media', value ->> '$.key' FROM json_each(?) WHERE 1 " +
      "ON CONFLICT(id) DO UPDATE SET url=excluded.url, created_at=excluded.created_at, title=excluded.title, " +
      "summary=excluded.summary, category=excluded.category, media=excluded.media " +
      "WHERE feed_items.url IS NOT excluded.url OR feed_items.created_at IS NOT excluded.created_at " +
      "OR feed_items.title IS NOT excluded.title OR feed_items.summary IS NOT excluded.summary " +
      "OR feed_items.category IS NOT excluded.category OR feed_items.media IS NOT excluded.media"
    ).bind(snapshot),
    env.DB.prepare("UPDATE feed_sync SET etag = ?, url = ? WHERE source = 'substack'").bind(response.headers.get('ETag'), url.href),
  ];
  await env.DB.batch(statements);
}
