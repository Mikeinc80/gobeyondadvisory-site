(() => {
  const motion = document.querySelector('#project-motion');
  const banner = motion.closest('.ticker-wrap');
  motion.hidden = false;
  motion.addEventListener('click', () => {
    const paused = banner.classList.toggle('paused');
    motion.textContent = paused ? 'Resume' : 'Pause';
    motion.setAttribute('aria-label', (paused ? 'Resume' : 'Pause') + ' project banner');
  });

  const audio = document.querySelector('#advisory-piano');
  const control = document.querySelector('#piano-control');
  const key = 'gba-piano-muted';
  let muted = false;
  try { muted = localStorage.getItem(key) === 'yes'; } catch {}
  audio.volume = 0.25;
  control.hidden = false;
  function label() {
    control.textContent = audio.paused ? 'Play piano' : 'Mute piano';
  }
  async function play() {
    try { await audio.play(); } catch { label(); }
  }
  audio.addEventListener('play', label);
  audio.addEventListener('pause', label);
  control.addEventListener('click', () => {
    muted = !audio.paused;
    if (muted) audio.pause();
    else play();
    try { localStorage.setItem(key, muted ? 'yes' : 'no'); } catch {}
  });
  function firstClick(event) {
    if (!event.isTrusted) return;
    document.removeEventListener('click', firstClick, true);
    if (!muted && !control.contains(event.target)) play();
  }
  document.addEventListener('click', firstClick, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.pause();
  });
})();
