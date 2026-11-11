// A viewer's explicit request is the only path that connects to the player.
document.addEventListener('click', function (event) {
  const button = event.target.closest('button[data-video]');
  if (!button || !/^[A-Za-z0-9_-]{11}$/.test(button.dataset.video)) return;
  const player = document.createElement('iframe');
  player.src = 'https://www.youtube-nocookie.com/embed/' + button.dataset.video;
  player.title = button.dataset.title;
  player.allowFullscreen = true;
  player.referrerPolicy = 'strict-origin-when-cross-origin';
  player.allow = 'encrypted-media; picture-in-picture';
  button.replaceWith(player);
  player.focus();
});
