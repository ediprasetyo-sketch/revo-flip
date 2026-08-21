(() => {
  function bind(selector, direction) {
    const button = document.querySelector(selector);
    if (!button) return;

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (button.disabled) return;

      const $book = window.jQuery ? window.jQuery('#flipbook') : null;
      if (!$book || !$book.data('turn')) return;

      try {
        const current = Number($book.turn('page')) || 1;
        const total = Number($book.turn('pages')) || current;
        const target = Math.max(1, Math.min(total, current + direction));
        if (target !== current) $book.turn('page', target);
      } catch (error) {
        console.error('Flip navigation failed', error);
      }
    }, true);
  }

  bind('#prev', -1);
  bind('#next', 1);
})();
