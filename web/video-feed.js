export function createVideoFeed(view) {
  const players = new Map();
  let active = null;
  let muted = true;
  let attempt = 0;
  let scheduled = false;

  const silent = video => video.muted || video.volume === 0;

  function updateButtons() {
    for (const [video, {button}] of players) {
      const soundOn = !(video === active ? silent(video) : muted);
      const label = soundOn ? 'Mute videos' : 'Unmute videos';
      button.textContent = soundOn ? '🔊' : '🔇';
      button.setAttribute('aria-pressed', String(soundOn));
      button.title = label;
    }
  }

  function mute(video, value) {
    if (!value && video.volume === 0) video.volume = 1;
    video.muted = value;
    players.get(video).expectedMute = silent(video);
  }

  function setActive(video) {
    if (active === video) return;
    const previous = active;
    active = video;
    attempt++;
    if (previous) {
      previous.pause();
      mute(previous, true);
    }
    if (video) mute(video, muted);
    updateButtons();
  }

  function start(video) {
    const id = ++attempt;
    mute(video, muted);
    updateButtons();
    video.play().catch(error => {
      if (id !== attempt || active !== video || silent(video) || error?.name !== 'NotAllowedError') return;
      mute(video, true);
      updateButtons();
      video.play().catch(() => {});
    });
  }

  function pickVisible() {
    if (view.document.hidden) return null;
    const {innerHeight, innerWidth} = view;
    let closest = null;
    let shortest = Infinity;
    for (const video of players.keys()) {
      const rect = video.getBoundingClientRect();
      const height = Math.min(innerHeight, rect.height);
      const visible = Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top);
      if (!height || visible < height * 0.55) continue;
      const distance = Math.abs(rect.top + rect.height / 2 - innerHeight / 2) +
        Math.abs(rect.left + rect.width / 2 - innerWidth / 2);
      if (distance >= shortest) continue;
      shortest = distance;
      closest = video;
    }
    return closest;
  }

  function update() {
    if (scheduled) return;
    scheduled = true;
    view.requestAnimationFrame(() => {
      scheduled = false;
      const video = pickVisible();
      if (video === active) return;
      setActive(video);
      if (video) start(video);
    });
  }

  function track(video, button) {
    const player = {button, expectedMute: silent(video)};
    players.set(video, player);
    button.setAttribute('aria-label', 'Video sound');
    button.addEventListener('click', () => {
      muted = video === active ? !silent(video) : !muted;
      setActive(video);
      if (video.paused) start(video);
      else {
        mute(video, muted);
        updateButtons();
      }
    });
    video.addEventListener('volumechange', () => {
      if (!players.has(video) || silent(video) === player.expectedMute) return;
      player.expectedMute = silent(video);
      muted = player.expectedMute;
      if (active && active !== video) mute(active, muted);
      if (video !== active) mute(video, true);
      updateButtons();
    });
    video.addEventListener('play', () => {
      if (players.has(video) && !video.paused) setActive(video);
    });
    updateButtons();
    update();
  }

  function forget(video) {
    if (video === active) setActive(null);
    players.delete(video);
    update();
  }

  function clear() {
    setActive(null);
    players.clear();
  }

  view.addEventListener('scroll', update, {passive: true});
  view.addEventListener('resize', update);
  view.document.addEventListener('visibilitychange', () => {
    if (view.document.hidden) setActive(null);
    else update();
  });
  return {track, forget, clear, update};
}
