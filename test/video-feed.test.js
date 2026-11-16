import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVideoFeed } from '../web/video-feed.js';

function fixture() {
  const view = new EventTarget();
  view.innerHeight = 800;
  view.innerWidth = 400;
  view.document = new EventTarget();
  view.document.hidden = false;
  const callbacks = [];
  view.requestAnimationFrame = callback => callbacks.push(callback);
  const move = positions => {
    positions.forEach(([video, top]) => { video.top = top; });
    view.dispatchEvent(new Event('scroll'));
    while (callbacks.length) callbacks.shift()();
  };
  return {view, move, feed:createVideoFeed(view)};
}

function player() {
  const video = new EventTarget();
  const button = new EventTarget();
  const values = {};
  button.setAttribute = (name, value) => { values[name] = value; };
  video.top = 1000;
  video.volume = 1;
  video.paused = true;
  video.allowSound = true;
  let muted = true;
  Object.defineProperty(video, 'muted', {
    get: () => muted,
    set(value) {
      if (muted === value) return;
      muted = value;
      queueMicrotask(() => video.dispatchEvent(new Event('volumechange')));
    },
  });
  video.getBoundingClientRect = () => ({top:video.top,bottom:video.top+420,height:420,left:20,width:360});
  video.play = async () => {
    if (!video.allowSound && !video.muted) throw Object.assign(new Error('blocked sound'), {name:'NotAllowedError'});
    video.paused = false;
    queueMicrotask(() => video.dispatchEvent(new Event('play')));
  };
  video.pause = () => { video.paused = true; };
  return {video, button, values};
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('visible videos autoplay muted and remember explicit and native sound toggles', async () => {
  const {view, feed, move} = fixture();
  const first = player(), second = player(), third = player();
  for (const p of [first, second, third]) feed.track(p.video, p.button);
  move([[first.video,175],[second.video,850],[third.video,1400]]);
  await flush();
  assert.equal(first.video.paused, false);
  assert.equal(first.video.muted, true);
  assert.equal(second.video.paused, true);

  first.button.dispatchEvent(new Event('click'));
  await flush();
  assert.equal(first.video.muted, false);
  assert.equal(first.values['aria-pressed'], 'true');

  move([[first.video,-500],[second.video,170],[third.video,850]]);
  await flush();
  assert.equal(first.video.paused, true);
  assert.equal(second.video.paused, false);
  assert.equal(second.video.muted, false);

  second.video.muted = true;
  await flush();
  move([[second.video,-500],[third.video,170]]);
  await flush();
  assert.equal(second.video.paused, true);
  assert.equal(third.video.paused, false);
  assert.equal(third.video.muted, true);

  third.video.pause();
  move([[third.video,180]]);
  assert.equal(third.video.paused, true, 'scrolling within the same clip honors a manual pause');
  view.document.hidden = true;
  view.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(third.video.paused, true);
});

test('browser sound restrictions fall back to silent playback and preserve the chosen preference', async () => {
  const {feed, move} = fixture();
  const first = player(), blocked = player(), next = player();
  blocked.video.allowSound = false;
  for (const p of [first, blocked, next]) feed.track(p.video, p.button);
  move([[first.video,175]]);
  first.button.dispatchEvent(new Event('click'));
  await flush();

  move([[first.video,-500],[blocked.video,175]]);
  await flush();
  assert.equal(blocked.video.paused, false);
  assert.equal(blocked.video.muted, true);
  assert.equal(blocked.values['aria-pressed'], 'false');

  move([[blocked.video,-500],[next.video,175]]);
  await flush();
  assert.equal(next.video.paused, false);
  assert.equal(next.video.muted, false);
  feed.clear();
  assert.equal(next.video.paused, true);
});
