import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { normalizeSubstackFeed, refreshSubstack } from '../server/substack.js';

const profile = 'https://substack.com/@nicjm';
const feedURL = new URL('https://feed.example.org/likes');
const hour = 60 * 60 * 1000;
const published = '2026-11-10T18:00:00.000Z';
const liked = '2026-11-16T08:30:00.000Z';
const noteURL = 'https://substack.com/@author/note/c-1234';
const postURL = 'https://author.substack.com/p/article';
const videoURL = 'https://substackcdn.com/video_upload/sample.mp4';
const snapshot = items => ({ profile, complete: true, items });
const note = { type: 'note', public: true, url: noteURL, published_at: published, liked_at: '2026-11-16T09:30:00+01:00', summary: '<Original> wording & punctuation.' };
const post = { type: 'post', public: true, url: postURL, published_at: published, title: 'Original title', summary: 'Original standfirst' };
const respond = (items, etag) => Response.json(snapshot(items), { headers: etag ? { ETag: etag } : {} });

let mf, db;
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: new URL('../dist/_worker.js', import.meta.url).pathname,
    compatibilityDate: '2026-10-30', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'substack-test' }, bindings: { SUBSTACK_LIKES_URL: feedURL.href },
  }));
  db = await mf.getD1Database('DB');
  const directory = new URL('../server/migrations/', import.meta.url);
  for (const file of (await readdir(directory)).sort()) {
    const sql = await readFile(new URL(file, directory), 'utf8');
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
});
after(async () => { await mf?.dispose(); });

test('Substack normalization preserves source wording and prefers a real like date', async () => {
  const [first, second] = await normalizeSubstackFeed(snapshot([
    { ...note, media: [
      { type: 'video', url: videoURL, width: 720, height: 1280, caption: 'Original caption' },
      { type: 'video', url: 'https://untrusted.example/video.mp4' },
      { type: 'image', url: 'https://substackcdn.com/image/fetch/photo.webp', alt: 'Original alt text' },
    ] },
    { ...note, url: 'https://substack.com/profile/99-another-name/note/c-1234?utm_source=share', liked_at: null },
    { ...post, url: 'https://open.substack.com/pub/author/p/article?r=tracking' },
    { ...post, public: false, url: 'https://author.substack.com/p/private' },
  ]));
  assert.equal(first.title, null);
  assert.equal(first.summary, note.summary);
  assert.equal(first.date, liked);
  assert.equal(first.category, 'videos');
  assert.equal(first.media.length, 2);
  assert.equal(first.media[0].url, videoURL);
  assert.equal(first.media[0].portrait, true);
  assert.equal(first.media[0].caption, 'Original caption');
  assert.equal(first.media[1].alt, 'Original alt text');
  assert.equal(second.url, postURL);
  assert.equal(second.date, published);
  assert.equal(second.title, post.title);
  await assert.rejects(normalizeSubstackFeed({ ...snapshot([note]), complete: false }));
  await assert.rejects(normalizeSubstackFeed(snapshot([{ ...note, liked_at: 'invalid', published_at: null }])));
});

test('Substack refresh is idempotent and mixes with saved cards without exposing private rows', async () => {
  const date = Date.now() + hour;
  const sync = (fetcher, at) => refreshSubstack({ DB: db }, feedURL, fetcher, at);
  await Promise.all([sync(() => respond([note, post], '"one"'), date), sync(() => respond([note, post], '"one"'), date)]);
  const savedID = randomUUID(), pendingID = randomUUID();
  await db.prepare("INSERT INTO items(id,kind,status,url,created_at,category,title) VALUES (?,'link','published',?,?,'articles','Saved headline')")
    .bind(savedID, 'https://open.substack.com/pub/author/p/article?utm_source=share', '2026-11-12T18:00:00.000Z').run();
  await db.prepare("INSERT INTO items(id,kind,url,shared_title) VALUES (?,'link',?,'Private title')")
    .bind(pendingID, noteURL).run();
  const read = async (query = '') => {
    const response = await mf.dispatchFetch('https://paperclip.test/api/items' + query);
    assert.equal(response.status, 200);
    return response.json();
  };
  let results = await read();
  assert.deepEqual(results.items.map(item => item.created_at), [liked, '2026-11-12T18:00:00.000Z']);
  assert.equal(results.items[0].summary, note.summary);
  assert.equal(results.items[0].source, 'substack');
  assert.equal(results.items[1].id, savedID);
  assert.equal(results.items[1].source, undefined);
  assert.ok(!JSON.stringify(results).includes('Private title'));
  assert.equal((await read('?tag=substack&category=notes')).items.length, 1);

  const count = async () => (await db.prepare("SELECT count(*) AS n FROM feed_items").first()).n;
  assert.equal(await count(), 2);
  await sync((_url, request) => {
    assert.equal(request.headers.get('If-None-Match'), '"one"');
    return new Response(null, { status: 304 });
  }, date + hour);
  assert.equal(await count(), 2);
  await assert.rejects(sync(() => Response.json({ ...snapshot([]), complete: false }), date + 2 * hour));
  assert.equal(await count(), 2);
  await sync(() => respond([note, { ...post, liked_at: liked }], '"two"'), date + 3 * hour);
  assert.equal(await count(), 2);
  await sync(() => respond([], '"empty"'), date + 4 * hour);
  assert.equal(await count(), 0);
  results = await read();
  assert.deepEqual(results.items.map(item => item.id), [savedID]);
});

test('shared Substack URLs expose official previews only after curation publishes them', async () => {
  const noteId = randomUUID(), postId = randomUUID(), pendingId = randomUUID(), heldId = randomUUID(), otherId = randomUUID();
  const capture = (id, url, status) => db.prepare("INSERT INTO items(id,kind,status,url) VALUES (?,'link',?,?)").bind(id, status, url);
  await db.batch([
    capture(noteId, noteURL + '?utm_source=share', 'published'),
    capture(postId, 'https://open.substack.com/pub/author/p/article?r=privacy#comments', 'published'),
    capture(pendingId, noteURL, 'pending'),
    capture(heldId, noteURL, 'held'),
    capture(otherId, 'https://notsubstack.com/p/article', 'published'),
  ]);
  const call = path => mf.dispatchFetch('https://paperclip.test' + path);
  const path = id => '/embed/substack/' + id;
  const list = await (await call('/api/items')).json();
  const urls = Object.fromEntries(list.items.map(item => [item.id, item.embed_url]));
  assert.equal(urls[noteId], path(noteId));
  assert.equal(urls[postId], path(postId));
  assert.equal(urls[otherId], undefined);
  assert.ok(!list.items.some(item => [pendingId, heldId].includes(item.id)));

  for (const [id, label, url] of [[noteId, 'data-comment-link', noteURL], [postId, 'data-post-link', postURL]]) {
    const response = await call(path(id));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Frame-Options'), 'SAMEORIGIN');
    const csp = response.headers.get('Content-Security-Policy');
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /sandbox allow-scripts/);
    assert.doesNotMatch(csp, /allow-same-origin/);
    const html = await response.text();
    assert.ok(html.includes(label + ' href="' + url + '"'));
    assert.ok(html.includes('https://substack.com/embedjs/embed.js'));
    assert.doesNotMatch(html, /utm_source=|r=privacy/);
  }
  for (const id of [pendingId, heldId, otherId, 'bad-id']) {
    assert.equal((await call(path(id))).status, 404);
  }
});

test('synced Substack videos also offer the official preview as a fallback', async () => {
  const id = randomUUID();
  await db.prepare("INSERT INTO feed_items(id,source,url,created_at,category,media,source_key) VALUES (?,'substack',?,?,'videos','[]','note:c-9001')")
    .bind(id, 'https://substack.com/@author/note/c-9001', liked).run();
  const call = path => mf.dispatchFetch('https://paperclip.test' + path);
  const feed = await (await call('/api/items?tag=substack&category=videos')).json();
  assert.equal(feed.items.find(item => item.id === id).embed_url, '/embed/substack/' + id);
  const preview = await call('/embed/substack/' + id);
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /https:\/\/substack\.com\/@author\/note\/c-9001/);
});
