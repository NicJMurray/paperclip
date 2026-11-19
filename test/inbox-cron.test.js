import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { curate, publicSource } from '../server/inbox-cron.js';

test('curation recognizes public URLs and strips tracking before lookup', () => {
  assert.equal(publicSource('https://en.wikipedia.org/wiki/D%C3%A9rive?wprov=sfla1').canonical.href, 'https://en.wikipedia.org/wiki/D%C3%A9rive');
  assert.equal(publicSource('https://youtu.be/abcdefghijk').category, 'videos');
  assert.equal(publicSource('https://www.youtube.com/watch?v=abcdefghijk&utm_source=share').canonical.search, '?v=abcdefghijk');
  assert.equal(publicSource('https://en.wikipedia.org/wiki/Example?token=secret'), null);
  assert.equal(publicSource('https://giftarticle.ft.com/giftarticle/private'), null);
  assert.equal(publicSource('https://talkie-lm.com/chat').category, 'tools');
  assert.equal(publicSource('https://talkie-lm.com/chat?token=secret'), null);
  assert.equal(publicSource('https://talkie-lm.com.evil.example/chat'), null);
});

test('private shares stay held, unsafe redirects stop and transient failures retry', async () => {
  const item = { kind:'link', url:'https://en.wikipedia.org/wiki/Example' };
  assert.match((await curate({...item,shared_text:'Do not publish'}, () => assert.fail())).reason, /private/);
  assert.match((await curate({...item,kind:'image',url:null}, () => assert.fail())).reason, /review/);
  let requests = 0;
  assert.match((await curate(item, () => {
    requests++;
    return new Response(null,{status:302, headers:{location:'http://localhost/private'}});
  })).reason, /redirected/);
  assert.equal(requests, 1);
  assert.equal(await curate(item, () => new Response(null,{status:429})), null);
});

test('a URL shared with a preview image publishes once using the source metadata', async () => {
  const curator = await readFile(new URL('../server/inbox-cron.js', import.meta.url), 'utf8');
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: [
      {type:'ESModule',path:'test-worker.js',contents:`
        import { sortInbox } from './inbox-cron.js';
        export default {async fetch(request, env) {
          return Response.json(await sortInbox(env.DB, () => new Response(
            '<html><head><title>talkie: an LM from 1930</title>' +
            '<meta name="description" content="A source description."></head></html>',
            {headers:{'content-type':'text/html'}}
          )));
        }};
      `},
      {type:'ESModule',path:'inbox-cron.js',contents:curator},
    ],
    compatibilityDate:'2026-10-30',
    d1Databases:{DB:'inbox-curation-test'},
  }));
  try {
    const db = await mf.getD1Database('DB');
    for (const file of ['0001_initial.sql', '0003_external_feed.sql']) {
      const sql = await readFile(new URL('../server/migrations/' + file, import.meta.url), 'utf8');
      for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) {
        await db.prepare(statement).run();
      }
    }
    await db.exec("INSERT INTO items(id,kind,url,shared_title,created_at) VALUES ('preview','image','https://talkie-lm.com/chat','Original capture','2026-11-19'); INSERT INTO image_chunks(item_id,part,data) VALUES ('preview',0,'AA=='); INSERT INTO items(id,kind) VALUES ('standalone','image'); INSERT INTO items(id,kind,status,url) VALUES ('held','link','held','https://talkie-lm.com/chat');");
    const sort = async () => (await mf.dispatchFetch('https://curator.test/')).json();
    assert.deepEqual(await sort(), {published:1,held:1,deferred:0});
    const published = await db.prepare("SELECT * FROM items WHERE id='preview'").first();
    assert.equal(published.status, 'published');
    assert.equal(published.kind, 'image');
    assert.equal(published.url, 'https://talkie-lm.com/chat');
    assert.equal(published.shared_title, 'Original capture');
    assert.equal(published.title, 'talkie: an LM from 1930');
    assert.equal(published.summary, 'A source description.');
    assert.equal(published.category, 'tools');
    assert.equal(published.created_at, '2026-11-19');
    assert.equal((await db.prepare("SELECT status FROM items WHERE id='held'").first()).status, 'held');
    assert.deepEqual(await sort(), {published:0,held:0,deferred:0});
  } finally {
    await mf.dispose();
  }
});
