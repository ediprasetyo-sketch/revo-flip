const params = new URLSearchParams(location.search);
const id = params.get('id');
const canvas = document.querySelector('#pdfCanvas');
const ctx = canvas.getContext('2d');
const stage = document.querySelector('#bookStage');
const shell = document.querySelector('.book-shell');
const label = document.querySelector('#pageLabel');
const loading = document.querySelector('.flip-loading');
const prev = document.querySelector('#prev');
const next = document.querySelector('#next');

let pdf = null;
let page = 1;
let rendering = false;
let resizeTimer = null;

function updateControls() {
  label.textContent = pdf ? `${page} / ${pdf.numPages}` : '– / –';
  prev.disabled = !pdf || page <= 1 || rendering;
  next.disabled = !pdf || page >= pdf.numPages || rendering;
}

function animateFlip(direction) {
  shell.classList.remove('turn-next', 'turn-prev');
  void shell.offsetWidth;
  shell.classList.add(direction === 'next' ? 'turn-next' : 'turn-prev');
  shell.addEventListener('animationend', () => shell.classList.remove('turn-next', 'turn-prev'), { once: true });
}

async function renderPage(target, direction = '') {
  if (!pdf || rendering) return;
  target = Math.max(1, Math.min(pdf.numPages, target));
  if (target === page && direction) return;

  rendering = true;
  updateControls();

  try {
    const pdfPage = await pdf.getPage(target);
    const base = pdfPage.getViewport({ scale: 1 });
    const availableWidth = Math.max(280, stage.clientWidth - 110);
    const availableHeight = Math.max(260, stage.clientHeight - 90);
    const scale = Math.min(availableWidth / base.width, availableHeight / base.height);
    const viewport = pdfPage.getViewport({ scale: Math.max(0.25, scale) });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);

    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    page = target;
    loading.hidden = true;
    if (direction) animateFlip(direction);
  } catch (err) {
    console.error(err);
    loading.hidden = false;
    loading.textContent = 'Gagal menampilkan halaman PDF.';
  } finally {
    rendering = false;
    updateControls();
  }
}

prev.addEventListener('click', () => renderPage(page - 1, 'prev'));
next.addEventListener('click', () => renderPage(page + 1, 'next'));

document.querySelector('#share').addEventListener('click', async () => {
  const url = location.href;
  try {
    if (navigator.share) {
      await navigator.share({ title: document.title, url });
    } else {
      await navigator.clipboard.writeText(url);
      const button = document.querySelector('#share');
      const original = button.innerHTML;
      button.innerHTML = '✓ <span>Link disalin</span>';
      setTimeout(() => { button.innerHTML = original; }, 1800);
    }
  } catch (err) {
    if (err.name !== 'AbortError') alert('Gagal membagikan link.');
  }
});

window.addEventListener('resize', () => {
  if (!pdf || rendering) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderPage(page), 160);
});

(async () => {
  if (!id) {
    loading.textContent = 'Flipbook tidak ditemukan.';
    return;
  }

  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    pdf = await pdfjsLib.getDocument(`/api/media/${encodeURIComponent(id)}`).promise;
    await renderPage(1);
  } catch (err) {
    console.error(err);
    loading.textContent = 'Gagal membuka PDF.';
  }
})();