import { SUBSTACK_PROFILE, refreshSubstack } from './substack.js';

const source = { profile: SUBSTACK_PROFILE, id: 361029705, handle: 'nicjm' };

function publicVideo(upload, host = 'substack.com', poster = null) {
  if (upload?.state !== 'transcoded' || upload.copyright_infringement ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(upload.id ?? '')) return [];
  if (!poster && upload.post_id == null &&
      Number.isSafeInteger(upload.user_id) && upload.user_id > 0 &&
      Number.isSafeInteger(upload.thumbnail_id) && upload.thumbnail_id > 0) {
    const frame = String(upload.thumbnail_id).padStart(5, '0');
    poster = 'https://substack-video.s3.amazonaws.com/video_upload/user/' +
      upload.user_id + '/' + upload.id + '/transcoded-' + frame + '.png';
  }
  return [{
    type: 'video',
    url: 'https://' + host + '/api/v1/video/upload/' + upload.id + '/src?type=mp4',
    width: upload.width,
    height: upload.height,
    poster,
  }];
}

function likedItem(item) {
  if (item.context?.type === 'note_like' && item.type === 'comment') {
    const note = item.comment;
    if (note?.type !== 'feed' || note.post_id != null || !Number.isSafeInteger(note.id) ||
        !/^[a-zA-Z0-9_-]+$/.test(note.handle ?? '')) return null;
    const media = (note.attachments ?? []).flatMap(attachment => {
      if (attachment.type === 'image') {
        return [{type: 'image', url: attachment.imageUrl, width: attachment.imageWidth, height: attachment.imageHeight}];
      }
      return attachment.type === 'video' ? publicVideo(attachment.mediaUpload) : [];
    });
    return {
      public: true,
      type: 'note',
      url: 'https://substack.com/@' + note.handle + '/note/c-' + note.id,
      liked_at: item.context.timestamp,
      published_at: note.date,
      summary: note.body,
      media,
      video: (note.attachments ?? []).some(attachment => attachment.type === 'video'),
    };
  }
  if (item.context?.type !== 'post_like' || item.type !== 'post') return null;
  const post = item.post;
  if (post?.audience !== 'everyone' || post.is_published !== true || item.publication?.invite_only ||
      post.is_geoblocked || post.is_editor_preview) return null;
  const publication = item.publication?.subdomain;
  const host = typeof publication === 'string' && /^[a-z0-9-]+$/i.test(publication)
    ? publication + '.substack.com' : 'substack.com';
  const videos = publicVideo(post.videoUpload, host, post.cover_image);
  return {
    public: true,
    type: 'post',
    url: post.canonical_url,
    liked_at: item.context.timestamp,
    published_at: post.post_date,
    title: post.title,
    summary: post.subtitle ?? post.description,
    media: videos.length ? videos : post.cover_image ? [{type: 'image', url: post.cover_image}] : [],
    video: post.type === 'video' || Boolean(post.video_upload_id),
  };
}

export async function publicLikes({ page }, source, toItem) {
  let destination;
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', request => request.isNavigationRequest() && request.url() === destination
    ? request.continue() : request.abort());

  async function readPage(url, contentType, limit) {
    destination = url;
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    if (!response?.ok() || response.url() !== url || !response.headers()['content-type']?.includes(contentType)) {
      throw new Error('Unexpected Substack response (' + (response?.status() ?? 'empty') + ')');
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > limit) throw new Error('Substack response too large');
    return text;
  }

  const html = await readPage(source.profile + '?tab=likes', 'text/html', 512 * 1024);
  const data = html.match(/<script[^>]+id="preloads-json"[^>]*>([^]*?)<\/script>/i)?.[1];
  const profile = data && JSON.parse(data).profile;
  if (!profile || profile.id !== source.id || profile.handle !== source.handle || typeof profile.hasLikes !== 'boolean') {
    throw new Error('Substack public profile format changed');
  }
  const items = [];
  const snapshot = {profile: source.profile, complete: true, items};
  if (profile.profile_disabled || !profile.hasLikes) return snapshot;

  const next = new URL('/api/v1/reader/feed/profile/' + source.id, source.profile);
  next.searchParams.set('types[]', 'like');
  const cursors = new Set();
  for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
    const {items: entries, nextCursor} = JSON.parse(await readPage(next.href, 'application/json', 3 * 1024 * 1024));
    if (!Array.isArray(entries) || (nextCursor !== null && typeof nextCursor !== 'string')) {
      throw new Error('Substack likes list format changed');
    }
    for (const item of entries) {
      const like = toItem(item);
      if (like) items.push(like);
    }
    if (!nextCursor) return snapshot;
    if (cursors.has(nextCursor)) throw new Error('Substack likes cursor repeated');
    cursors.add(nextCursor);
    next.searchParams.set('cursor', nextCursor);
  }
  throw new Error('Substack likes exceeded pagination limit');
}

// Browser Run executes this script in one signed-out browser session.
export const likesBrowserScript = `async context => {
  const publicVideo = ${publicVideo};
  return (${publicLikes})(context, ${JSON.stringify(source)}, ${likedItem});
}`;

export default {
  async scheduled(_event, env) {
    let count;
    await refreshSubstack(env, new URL(SUBSTACK_PROFILE), async () => {
      const response = await env.BROWSER.script(likesBrowserScript, {
        library: 'puppeteer', timeout: 40000, keepAlive: 10000,
      });
      const session = response.headers.get('cf-browser-session-id');
      try {
        if (!response.ok) throw new Error('Substack browser request failed (' + response.status + ')');
        const { success, result } = await response.json();
        if (!success || !Array.isArray(result?.items)) throw new Error('Invalid Substack browser result');
        count = result.items.length;
        return Response.json(result);
      } finally {
        if (session) await env.BROWSER.closeSession(session).catch(() => {
          console.warn(JSON.stringify({event: 'substack_browser_close_failed'}));
        });
      }
    });
    if (count !== undefined) console.info(JSON.stringify({event: 'substack_public_snapshot', items: count}));
  },
};
