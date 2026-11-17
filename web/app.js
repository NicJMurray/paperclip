import { createVideoFeed } from './video-feed.js';

const state = { items: [], categories: [], category: 'all', tag: '', query: '', cursor: null, busy: false, failed: false, serial: 0 };
const $ = id => document.getElementById(id);
const label = value => value.charAt(0).toUpperCase() + value.slice(1);
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
function safeURL(value) { try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u : null; } catch { return null; } }
let loadHls;
function hlsLibrary() {
  if (loadHls) return loadHls;
  loadHls = new Promise((resolve, reject) => {
    const script = element('script');
    script.src = '/hls.js';
    script.onload = () => resolve(window.Hls);
    script.onerror = () => { script.remove(); loadHls = null; reject(new Error('Player unavailable')); };
    document.head.append(script);
  });
  return loadHls;
}

function sourceLink(url, text, className = '') {
  const link = element('a', className, text);
  link.href = url.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

const videoOrigins = new Set();
function warmVideoConnections(url) {
  const source = safeURL(url);
  if (!source) return;
  const origins = [source.origin];
  if (source.pathname.startsWith('/api/v1/video/upload/')) origins.push('https://stream.mux.com');
  for (const origin of origins) {
    if (videoOrigins.has(origin)) continue;
    videoOrigins.add(origin);
    const link = element('link');
    link.rel = 'preconnect';
    link.href = origin;
    document.head.append(link);
  }
}

function importedMedia(attachment, original, reference) {
  const url = safeURL(attachment.url);
  if (!url || url.protocol !== 'https:') return null;
  const figure = element('figure', 'source-media');
  if (attachment.type === 'image') {
    const image = element('img');
    image.src = url.href;
    image.alt = attachment.alt || '';
    image.loading = 'lazy';
    image.decoding = 'async';
    const link = sourceLink(original, '', 'image-link');
    link.setAttribute('aria-label', attachment.alt || 'View image at source');
    link.append(image);
    figure.append(link);
  } else if (attachment.type === 'video') {
    const video = element('video', attachment.portrait ? 'portrait' : '');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'none';
    if (attachment.poster) video.poster = attachment.poster;
    video.setAttribute('aria-label', attachment.alt || reference || 'Video');
    const unavailable = element('p', 'video-error', 'Video unavailable here.');
    unavailable.hidden = true;
    function showFallback() {
      video.hidden = true;
      unavailable.hidden = false;
    }
    video.addEventListener('error', showFallback);
    if (attachment.format === 'hls' && !video.canPlayType('application/vnd.apple.mpegurl')) {
      video.controls = false;
      const play = element('button', 'video-play', 'Play video');
      play.addEventListener('click', async () => {
        play.disabled = true;
        try {
          const Hls = await hlsLibrary();
          if (!Hls?.isSupported()) throw new Error('Streaming unavailable');
          if (!video.isConnected) return;
          const player = new Hls({ enableWorker: false });
          video.addEventListener('paperclip-remove', () => player.destroy(), { once: true });
          player.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) { player.destroy(); showFallback(); }
          });
          player.on(Hls.Events.MEDIA_ATTACHED, () => {
            player.loadSource(url.href);
            video.play().catch(() => {});
          });
          player.attachMedia(video);
          video.controls = true;
          play.hidden = true;
          video.focus();
        } catch {
          play.hidden = true;
          showFallback();
        }
      }, { once: true });
      figure.append(play);
    } else {
      video.src = url.href;
    }
    figure.append(video, unavailable);
  } else {
    return null;
  }
  if (attachment.caption) figure.append(element('figcaption', '', attachment.caption));
  return figure;
}

const scrollingVideos = createVideoFeed(window);
const touchPlayback = matchMedia('(hover: none) and (pointer: coarse)');
new ResizeObserver(scrollingVideos.update).observe($('items'));

const substackFrames = new WeakMap();
window.addEventListener('message', event => {
  const player = substackFrames.get(event.source);
  if (!player || event.origin !== player.origin || event.data?.type !== 'paperclip:embed-height') return;
  const height = event.data.height;
  if (!Number.isFinite(height) || height <= 0) return;
  player.frame.height = Math.min(2400, Math.max(56, Math.ceil(height)));
});

function playerFrame(src, title) {
  const frame = element('iframe');
  frame.title = title;
  frame.allow = 'fullscreen; picture-in-picture; encrypted-media';
  frame.allowFullscreen = true;
  frame.src = src;
  return frame;
}

function videoHeading(title, original) {
  const heading = element('div', 'video-heading');
  if (title) {
    const h2 = element('h2');
    if (original) h2.append(sourceLink(original, title));
    else h2.textContent = title;
    heading.append(h2);
  }
  return heading;
}

function videoPoster(url) {
  if (!url) return null;
  const image = element('img', 'video-poster');
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.fetchPriority = 'low';
  image.src = url;
  image.addEventListener('error', () => image.remove(), { once: true });
  return image;
}

function linkedVideoCard(item, original, media) {
  const card = element('article', 'card paperclip-video-card');
  const title = item.title || item.summary?.split(/\n\s*\n/)[0]?.trim();
  const poster = videoPoster(media?.poster);
  const heading = videoHeading(title, poster ? null : original);
  if (poster) {
    const stage = element('div', media.portrait ? 'video-stage video-link-stage portrait' : 'video-stage video-link-stage');
    const link = sourceLink(original, '↗', 'video-start video-source');
    link.setAttribute('aria-label', title ? 'Watch ' + title + ' on Substack' : 'Watch on Substack');
    stage.append(poster, link);
    card.append(heading, stage);
  } else {
    if (!title) heading.append(sourceLink(original, 'Watch on Substack'));
    card.append(heading);
  }
  return card;
}

function directVideoCard(item, original, media) {
  const card = element('article', 'card paperclip-video-card');
  const title = item.title || item.summary?.split(/\n\s*\n/)[0]?.trim();
  const heading = videoHeading(title, original);
  const sound = element('button', 'video-sound', '🔇');
  sound.type = 'button';
  heading.append(sound);

  const stage = element('div', 'video-stage');
  const video = element('video', media.portrait ? 'portrait' : '');
  const poster = videoPoster(media.poster);
  const play = element('button', 'video-start', '▶');
  play.type = 'button';
  play.setAttribute('aria-label', title ? 'Play ' + title : 'Play video');
  play.addEventListener('click', () => {
    scrollingVideos.play(video);
    video.focus();
  });
  video.addEventListener('playing', () => {
    play.hidden = true;
    if (poster) poster.hidden = true;
  });
  video.playsInline = true;
  video.defaultMuted = true;
  video.muted = true;
  video.preload = 'none';
  video.setAttribute('aria-label', title || 'Substack video');
  const streamed = media.format === 'hls';
  // Try HLS only when the source explicitly supplies a playlist. The optional
  // Substack upload redirect can fail even when canPlayType reports support.
  const direct = !streamed || video.canPlayType('application/vnd.apple.mpegurl');
  if (touchPlayback.matches && !navigator.connection?.saveData && videoOrigins.size === 0) {
    warmVideoConnections(media.url);
  }
  stage.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse') warmVideoConnections(media.url);
  });
  play.addEventListener('focus', () => warmVideoConnections(media.url));
  let attached = false;
  let prefetched = false;
  let player;
  let loading;
  let generation = 0;
  let resumeAt = 0;

  function loadDirect() {
    attached = true;
    video.src = media.url;
    if (resumeAt) video.currentTime = resumeAt;
  }

  function warm() {
    if (attached) return;
    prefetched = true;
    video.preload = 'metadata';
    loadDirect();
  }

  function fallback() {
    if (!attached || !card.isConnected) return;
    scrollingVideos.forget(video);
    card.replaceWith(linkedVideoCard(item, original, media));
  }

  async function loadStream(id) {
    try {
      const Hls = await hlsLibrary();
      if (id !== generation) return;
      if (!Hls?.isSupported()) throw new Error('Streaming unavailable');
      player = new Hls({
        enableWorker: false, startLevel: 0, autoStartLoad: false,
        maxBufferLength: 8, maxMaxBufferLength: 12, backBufferLength: 5,
      });
      player.on(Hls.Events.MANIFEST_PARSED, () => {
        const cap = player.levels.findLastIndex(level => Math.min(level.width, level.height) <= 720);
        player.autoLevelCapping = Math.max(0, cap);
        player.startLoad(resumeAt || -1);
      });
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal && id === generation) fallback();
      });
      player.loadSource(media.url);
      player.attachMedia(video);
    } catch {
      if (id === generation) fallback();
    }
  }

  function prepare() {
    video.controls = true;
    if (prefetched) {
      prefetched = false;
      if (video.error) loadDirect();
      return;
    }
    if (attached) return loading;
    if (direct) {
      loadDirect();
      return;
    }
    attached = true;
    loading = loadStream(generation);
    return loading;
  }

  function release() {
    if (!attached) return;
    if (video.currentTime > 0) resumeAt = video.ended ? 0 : video.currentTime;
    generation++;
    attached = false;
    prefetched = false;
    loading = null;
    player?.destroy();
    player = null;
    video.removeAttribute('src');
    video.preload = 'none';
    video.load();
    video.controls = false;
    play.hidden = false;
    if (poster) poster.hidden = false;
  }

  video.addEventListener('error', () => { if (!player && !prefetched) fallback(); });
  stage.append(video);
  if (poster) stage.append(poster);
  stage.append(play);
  card.append(heading, stage);
  scrollingVideos.track(video, sound, {prepare, release, warm: direct ? warm : undefined});
  return card;
}

function substackPreview(path) {
  const preview = element('details', 'substack-preview');
  preview.append(element('summary', '', 'Preview on Paperclip'));
  let frame;
  preview.addEventListener('toggle', () => {
    if (!preview.open) {
      if (frame) {
        substackFrames.delete(frame.contentWindow);
        frame.remove();
        frame = null;
      }
      return;
    }
    if (frame) return;
    frame = playerFrame(path, 'Substack preview');
    frame.height = 200;
    preview.append(frame);
    substackFrames.set(frame.contentWindow, { frame, origin: location.origin });
  });
  return preview;
}

function card(item) {
  const url = safeURL(item.url);
  if (item.player_url && url) {
    const media = item.media?.find(attachment => attachment.type === 'video');
    return media ? directVideoCard(item, url, media) : linkedVideoCard(item, url);
  }
  const article = element('article',url ? 'card card--link' : 'card');
  if (item.source) article.classList.add('card--source');
  const attachments = item.source && url && Array.isArray(item.media) ? item.media : [];
  const showMedia = item.category === 'images' || item.category === 'videos';
  let thumbnail = null;
  if (item.kind === 'image') {
    const mediaURL = `/media/${encodeURIComponent(item.id)}`;
    const link = element('a','image-link'); link.href = url ? url.href : mediaURL; link.target = '_blank'; link.rel = 'noopener noreferrer';
    if (url) link.setAttribute('aria-label',item.title || url.hostname);
    const img = element('img'); img.src = mediaURL; img.alt = url ? '' : item.title || 'Saved image'; img.loading = 'lazy'; img.decoding = 'async'; link.append(img);
    if (url) thumbnail = link; else article.append(link);
  }
  if (!showMedia && attachments.some(media => media.type === 'image')) {
    const image = attachments.find(media => media.type === 'image');
    thumbnail = importedMedia({ ...image, caption: '' }, url, item.title)?.firstElementChild;
  }
  const content = element('div','card-content'), head = element('div','card-heading');
  head.append(element('span','category',item.category || 'other'));
  if (thumbnail) head.append(thumbnail);
  if (url) head.append(element('span','arrow','↗'));
  const h2 = element('h2');
  if (url) h2.append(sourceLink(url, item.title || url.hostname));
  else h2.textContent = item.title || 'A small discovery';
  content.append(head);
  if (!item.source || item.title) content.append(h2);
  if (item.summary) content.append(element('p','',item.summary));
  if (showMedia) {
    for (const attachment of attachments.slice(0, 6)) {
      const figure = importedMedia(attachment, url, item.title);
      if (figure) content.append(figure);
    }
  }
  if (item.embed_url) content.append(substackPreview(item.embed_url));
  const tags = element('div','tags');
  for (const tag of (Array.isArray(item.tags) ? item.tags : [])) { const button = element('button','tag',`#${tag}`); button.addEventListener('click',()=>{state.tag=tag;void load(true);}); tags.append(button); }
  content.append(tags);
  const source = element('div','source'); const date = new Date(item.created_at);
  const host = url?.hostname.replace(/^www\./, '');
  const attribution = item.source && url
    ? sourceLink(url, host === 'substack.com' ? 'Substack' : 'Substack · ' + host, 'source-link')
    : element('span', '', host || (item.kind === 'image' ? 'A saved image' : 'A saved note'));
  source.append(attribution, element('span','',Number.isNaN(+date) ? '' : date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})));
  content.append(source); article.append(content); return article;
}
function render() {
  const categories = state.categories;
  $('categories').replaceChildren();
  for (const category of ['all',...categories]) { const b = element('button',state.category === category ? 'active' : '',category === 'all' ? 'Everything' : label(category)); b.setAttribute('aria-pressed',String(state.category === category)); b.addEventListener('click',()=>{state.category=category;void load(true);}); $('categories').append(b); }
  const words = state.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const items = state.items.filter(x=>(state.category === 'all' || x.category === state.category) && (!state.tag || x.tags?.includes(state.tag)) && words.every(word=>[x.title,x.summary,x.url,...(x.tags || [])].join(' ').toLowerCase().includes(word)));
  for (const video of $('items').querySelectorAll('video')) video.dispatchEvent(new Event('paperclip-remove'));
  scrollingVideos.clear();
  $('items').replaceChildren(...items.map(card));
  $('count').textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}${state.tag ? ` tagged #${state.tag}` : ''}${state.cursor ? ' loaded' : ''}`;
  $('clear').hidden = !(state.query || state.tag || state.category !== 'all');
  $('message').hidden = items.length > 0;
  $('message').replaceChildren();
  if (!items.length) {
    const filtered = state.query || state.tag || state.category !== 'all';
    $('message').append(element('strong','', state.failed ? 'The collection is taking a moment.' : !filtered ? 'A place for the good finds.' : 'No matches this time.'),element('span','',state.failed ? 'Please reload to try again.' : !filtered ? 'The first collection will appear here after the next weekly sort.' : 'Try another search, or clear your filters.'));
  }
  $('more').hidden = !state.cursor; $('more').disabled = state.busy; $('more').textContent = state.busy ? 'Loading…' : 'Load more';
}
async function load(reset = false) {
  if (reset) { state.serial++; state.items=[]; state.cursor=null; }
  else if (state.busy) return;
  const serial = state.serial; state.busy = true; $('more').disabled = true;
  try {
    const params = new URLSearchParams(); if (state.cursor) params.set('after',state.cursor); if (state.query) params.set('q',state.query); if (state.tag) params.set('tag',state.tag); if (state.category !== 'all') params.set('category',state.category);
    const response = await fetch('/api/items?'+params,{cache:'no-store'});
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json(); if (serial !== state.serial) return; state.items.push(...data.items); state.categories=data.categories || []; state.cursor = data.next; state.failed = false;
  } catch { if (serial === state.serial) state.failed = true; }
  finally { if (serial === state.serial) {state.busy = false; render();} }
}
let searchTimer;
$('search').addEventListener('input',event=>{state.query=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>void load(true),180);});
$('clear').addEventListener('click',()=>{state.category='all';state.tag='';state.query='';$('search').value='';void load(true);});
$('more').addEventListener('click',()=>void load());
void load();
