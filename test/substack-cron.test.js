import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicLikes } from '../server/substack-cron.js';
import { normalizeSubstackFeed } from '../server/substack.js';

const date = '2026-10-01T08:00:00.000Z';
const like = '2026-11-16T12:00:00.000Z';
const profile = hasLikes => new Response(
  '<script type="application/json" id="preloads-json">' +
  JSON.stringify({profile: {id:361029705, handle:'nicjm', hasLikes}}) + '</script>',
  {headers:{'content-type':'text/html; charset=utf-8'}},
);
const note = {
  type:'comment', context:{type:'note_like', timestamp:like},
  comment:{type:'feed', post_id:null, id:456, handle:'creator', body:'The original Note.', date,
    attachments:[{type:'video', mediaUpload:{state:'transcoded', media_type:'video', mux_playback_id:'Abc123', width:1080,height:1920}}]},
};
const post = {
  type:'post', context:{type:'post_like'},
  post:{audience:'everyone', is_published:true, canonical_url:'https://news.example/p/original',
    post_date:date, title:'Original title', subtitle:'Original subtitle.'},
};
const page = (items, nextCursor = null) => Response.json({items, nextCursor});

test('public likes follow Substack cursors and preserve original content and flag videos for Substack playback', async () => {
  const calls = [];
  const feed = await publicLikes(url => {
    calls.push(url);
    if (calls.length === 1) return profile(true);
    if (calls.length === 2) return page([note, {...post, post:{...post.post,audience:'only_paid'}}], 'second-page');
    return page([post]);
  });
  assert.equal(new URL(calls[0]).searchParams.get('tab'), 'likes');
  assert.equal(new URL(calls[1]).searchParams.get('types[]'), 'like');
  assert.equal(new URL(calls[2]).searchParams.get('cursor'), 'second-page');
  const normalized = await normalizeSubstackFeed(feed);
  assert.deepEqual(normalized.map(i=>i.date), [like,date]);
  assert.equal(normalized[0].summary, note.comment.body);
  assert.equal(normalized[0].category, 'videos');
  assert.deepEqual(normalized[0].media, []);
  assert.equal(normalized[1].title, post.post.title);
});

test('the public likes reader honors profile visibility and rejects incomplete lists', async () => {
  assert.deepEqual((await publicLikes(url => {
    assert.equal(new URL(url).pathname, '/@nicjm');
    return profile(false);
  })).items, []);
  const first = new URL('https://substack.com/@nicjm?tab=likes');
  const reply = url => new URL(url).href === first.href ? profile(true) : page([note], 'same-cursor');
  await assert.rejects(publicLikes(reply), /cursor repeated/);
  await assert.rejects(publicLikes(() => new Response('', {status:429})), /429/);
  await assert.rejects(publicLikes((_url, request) => {
    assert.equal(request.redirect, 'manual');
    return new Response(null, {status:302, headers:{location:'https://substack.com/sign-in'}});
  }), /302/);
});
