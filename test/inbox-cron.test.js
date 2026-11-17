import assert from 'node:assert/strict';
import { test } from 'node:test';
import { curate, publicSource } from '../server/inbox-cron.js';

test('curation recognizes public URLs and strips tracking before lookup', () => {
  assert.equal(publicSource('https://en.wikipedia.org/wiki/D%C3%A9rive?wprov=sfla1').canonical.href, 'https://en.wikipedia.org/wiki/D%C3%A9rive');
  assert.equal(publicSource('https://youtu.be/abcdefghijk').category, 'videos');
  assert.equal(publicSource('https://www.youtube.com/watch?v=abcdefghijk&utm_source=share').canonical.search, '?v=abcdefghijk');
  assert.equal(publicSource('https://en.wikipedia.org/wiki/Example?token=secret'), null);
  assert.equal(publicSource('https://giftarticle.ft.com/giftarticle/private'), null);
});

test('private shares stay held, unsafe redirects stop and transient failures retry', async () => {
  const item = { kind:'link', url:'https://en.wikipedia.org/wiki/Example' };
  assert.match((await curate({...item,shared_text:'Do not publish'}, () => assert.fail())).reason, /private/);
  assert.match((await curate({...item,kind:'image'}, () => assert.fail())).reason, /review/);
  let requests = 0;
  assert.match((await curate(item, () => {
    requests++;
    return new Response(null,{status:302, headers:{location:'http://localhost/private'}});
  })).reason, /redirected/);
  assert.equal(requests, 1);
  assert.equal(await curate(item, () => new Response(null,{status:429})), null);
});
