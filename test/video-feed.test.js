import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVideoFeed } from '../web/video-feed.js';

function fixture(autoplay = true) {
  const view = new EventTarget();
  view.innerHeight = 800;
  view.innerWidth = 400;
  view.scrollY = 0;
  view.navigator = {connection: new EventTarget()};
  view.document = new EventTarget();
  view.document.hidden = false;
  const pointer = new EventTarget();
  pointer.matches = autoplay;
  view.matchMedia = () => pointer;
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
  video.readyState = 0;
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

test('desktop waits for an explicit play and mobile stops loading the clip it leaves', async () => {
  for (const autoplay of [false, true]) {
    const {feed, move} = fixture(autoplay);
    const first = player(), second = player();
    const loads = [], releases = [];
    for (const p of [first, second]) {
      feed.track(p.video, p.button, {prepare: () => { loads.push(p); }, release: () => { releases.push(p); }});
    }
    move([[first.video,175],[second.video,850]]);
    await flush();
    assert.deepEqual(loads, autoplay ? [first] : []);
    if (!autoplay) feed.play(first.video);
    move([[first.video,-500],[second.video,170]]);
    await flush();
    assert.deepEqual(loads, autoplay ? [first, second] : [first]);
    assert.deepEqual(releases, autoplay ? [first] : []);
    if (!autoplay) feed.play(second.video);
    assert.deepEqual(releases, [first]);
    assert.equal(first.video.paused, true);
    assert.equal(second.video.paused, false);
  }
});

test('mobile warms one nearby clip after playback is ready and reuses it when scrolling', () => {
  const {view, feed, move} = fixture();
  const current = player(), next = player(), later = player();
  const warm = [], releases = [];
  for (const p of [current, next, later]) {
    feed.track(p.video, p.button, {warm: () => warm.push(p), release: () => releases.push(p)});
  }
  move([[current.video,175],[next.video,850],[later.video,1050]]);
  assert.deepEqual(warm, []);
  current.video.readyState = 3;
  current.video.dispatchEvent(new Event('canplay'));
  move([]);
  assert.deepEqual(warm, [next]);
  assert.equal(next.video.paused, true);
  current.video.readyState = 2;
  current.video.dispatchEvent(new Event('waiting'));
  move([]);
  assert.deepEqual(releases, [], 'a stall keeps the next clip attached');

  view.scrollY = 280;
  move([[current.video,-270],[next.video,430],[later.video,950]]);
  assert.equal(next.video.paused, false);
  assert.deepEqual(releases, [current], 'keeps the preloaded source attached');
  assert.deepEqual(warm, [next], 'does not fetch the next card until playback is ready');

  next.video.readyState = 3;
  move([]);
  assert.deepEqual(warm, [next, later]);
  view.navigator.connection.saveData = true;
  view.navigator.connection.dispatchEvent(new Event('change'));
  move([]);
  assert.deepEqual(releases, [current, later]);
  assert.equal(next.video.paused, false);
});

test('speculative media stays off on desktop and slow connections', () => {
  for (const [autoplay, effectiveType] of [[false, '4g'], [true, '2g']]) {
    const {view, feed, move} = fixture(autoplay);
    view.navigator.connection.effectiveType = effectiveType;
    const next = player();
    feed.track(next.video, next.button, {warm: () => assert.fail('unexpected preload')});
    move([[next.video,850]]);
    assert.equal(next.video.paused, true);
  }
});
