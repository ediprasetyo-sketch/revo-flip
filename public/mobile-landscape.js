(() => {
  const stage = document.querySelector('#bookStage');
  const viewport = document.querySelector('.flipbook-viewport');
  const isPhoneLandscape = () => window.matchMedia('(max-width: 900px) and (orientation: landscape) and (pointer: coarse)').matches;

  function resizeBook() {
    if (!isPhoneLandscape() || !stage || !viewport || !window.jQuery) return;
    const $book = window.jQuery('#flipbook');
    if (!$book.length || !$book.data('turn')) return;

    const first = $book.find('.page').first();
    if (!first.length) return;
    const ratio = first.width() / Math.max(1, first.height());
    const availableW = Math.max(1, viewport.clientWidth - 8);
    const availableH = Math.max(1, viewport.clientHeight - 8);
    const singleW = Math.max(1, Math.min(availableW / 2, availableH * ratio));
    const singleH = Math.max(1, singleW / ratio);

    try {
      $book.turn('size', Math.floor(singleW * 2), Math.floor(singleH));
      $book.css({ width: `${Math.floor(singleW * 2)}px`, height: `${Math.floor(singleH)}px` });
    } catch (_) {}
  }

  function schedule() { requestAnimationFrame(() => requestAnimationFrame(resizeBook)); }
  const timer = setInterval(() => {
    if (window.jQuery && window.jQuery('#flipbook').data('turn')) {
      clearInterval(timer);
      schedule();
    }
  }, 80);

  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(schedule, 180), { passive: true });
})();
