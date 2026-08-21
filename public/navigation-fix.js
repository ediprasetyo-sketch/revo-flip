(() => {
  let bound = false;

  function book() {
    const $book = window.jQuery ? window.jQuery('#flipbook') : null;
    return $book && $book.data('turn') ? $book : null;
  }

  function updateLabel($book) {
    const label = document.querySelector('#pageLabel');
    if (!label || !$book) return;

    try {
      const total = Number($book.turn('pages')) || 0;
      const view = ($book.turn('view') || []).filter(n => Number.isFinite(Number(n)) && n >= 1 && n <= total);
      label.textContent = view.length > 1
        ? `${view[0]}-${view[view.length - 1]} / ${total}`
        : `${view[0] || 1} / ${total}`;
    } catch (_) {}
  }

  function go(direction) {
    const $book = book();
    if (!$book) return;

    try {
      if ($book.turn('animating')) return;
      if (direction === 'next') $book.turn('next');
      else $book.turn('previous');
    } catch (error) {
      console.error('Flip navigation failed', error);
    }
  }

  function bindWhenReady() {
    const $book = book();
    if (!$book) {
      setTimeout(bindWhenReady, 80);
      return;
    }
    if (bound) return;
    bound = true;

    // Satu klik = satu VIEW/SPREAD. Turn.js sendiri menangani 1 -> 2-3 -> 4-5.
    document.addEventListener('click', event => {
      const button = event.target.closest('#prev, #next');
      if (!button || button.disabled) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      go(button.id === 'next' ? 'next' : 'previous');
    }, true);

    $book.off('turned.navfix turning.navfix');
    $book.on('turned.navfix', () => updateLabel($book));
    $book.on('turning.navfix', () => updateLabel($book));
    updateLabel($book);
  }

  bindWhenReady();
})();
