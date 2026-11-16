import { SUBSTACK_PROFILE, refreshSubstack } from './substack.js';

const PROFILE_ID = 361029705;
const PROFILE_LIKES_PAGE = SUBSTACK_PROFILE + '?tab=likes';
const LIKES_URL = new URL('/api/v1/reader/feed/profile/' + PROFILE_ID, SUBSTACK_PROFILE);
LIKES_URL.searchParams.set('types[]', 'like');
const MAX_PAGES = 20;

async function publicResponse(fetchPage, url, accept, signal) {
  const response = await fetchPage(url, { headers: { Accept: accept }, redirect: 'manual', cache: 'no-store', signal });
  if (!response.ok || !response.headers.get('content-type')?.includes(accept)) {
    throw new Error('Unexpected Substack response (' + response.status + ')');
  }
  return response;
}

async function responseText(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing Substack response body');
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const {value, done} = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new Error('Substack response too large');
    }
    text += decoder.decode(value, {stream: true});
  }
}

function videoMedia(upload) {
  if (upload?.state !== 'transcoded' || upload.media_type !== 'video' ||
      upload.copyright_infringement || !/^[a-zA-Z0-9]+$/.test(upload.mux_playback_id ?? '')) return [];
  const id = upload.mux_playback_id;
  return [{
    type: 'video',
    url: 'https://stream.mux.com/' + id + '.m3u8',
    poster: 'https://image.mux.com/' + id + '/thumbnail.jpg',
    width: upload.width,
    height: upload.height,
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
      return attachment.type === 'video' ? videoMedia(attachment.mediaUpload) : [];
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
  return {
    public: true,
    type: 'post',
    url: post.canonical_url,
    liked_at: item.context.timestamp,
    published_at: post.post_date,
    title: post.title,
    summary: post.subtitle ?? post.description,
    media: [...videoMedia(post.videoUpload), ...(post.cover_image && !post.videoUpload ? [{type: 'image', url: post.cover_image}] : [])],
    video: post.type === 'video' || Boolean(post.video_upload_id),
  };
}

export async function publicLikes(fetchPage = fetch, signal = AbortSignal.timeout(30000)) {
  const profilePage = await publicResponse(fetchPage, PROFILE_LIKES_PAGE, 'text/html', signal);
  const html = await responseText(profilePage, 512 * 1024);
  const data = html.match(/<script[^>]+id="preloads-json"[^>]*>([^]*?)<\/script>/i)?.[1];
  const profile = data && JSON.parse(data).profile;
  if (!profile || profile.id !== PROFILE_ID || profile.handle !== 'nicjm' || typeof profile.hasLikes !== 'boolean') {
    throw new Error('Substack public profile format changed');
  }
  const items = [];
  const snapshot = {profile: SUBSTACK_PROFILE, complete: true, items};
  if (profile.profile_disabled || !profile.hasLikes) return snapshot;

  const next = new URL(LIKES_URL);
  const cursors = new Set();
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await publicResponse(fetchPage, next.href, 'application/json', signal);
    const {items: entries, nextCursor} = JSON.parse(await responseText(result, 3 * 1024 * 1024));
    if (!Array.isArray(entries) || (nextCursor !== null && typeof nextCursor !== 'string')) {
      throw new Error('Substack likes list format changed');
    }
    for (const item of entries) {
      const like = likedItem(item);
      if (like) items.push(like);
    }
    if (!nextCursor) return snapshot;
    if (cursors.has(nextCursor)) throw new Error('Substack likes cursor repeated');
    cursors.add(nextCursor);
    next.searchParams.set('cursor', nextCursor);
  }
  throw new Error('Substack likes exceeded pagination limit');
}

export default {
  async scheduled(_event, env) {
    await refreshSubstack(env, LIKES_URL, async () => {
      const snapshot = await publicLikes();
      console.info(JSON.stringify({event: 'substack_public_snapshot', items: snapshot.items.length}));
      return Response.json(snapshot);
    });
  },
};
