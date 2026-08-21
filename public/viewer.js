const params = new URLSearchParams(location.search);
const id = params.get('id');
const canvas = document.querySelector('#pdfCanvas');
const ctx = canvas.getContext('2d');
const stage = document.querySelector('#bookStage');
const label = document.querySelector('#pageLabel');
const loading = document.querySelector('.flip-loading');
const prev = document.querySelector('#prev');
const next = document.querySelector('#next');
let pdf, page = 1, rendering = false;

function updateControls() {
  label.textContent = pdf ? `${page} / ${pdf.numPages}` : '– / –';
  prev.disabled = !pdf || page <= 1 || rendering;
  next.disabled = !pdf || page >= pdf.numPages || rendering;
}

async function renderPage(target, direction = '') {
  if (!pdf || rendering) return;
  target = Math.max(1, Math.min(pdf.numPages, target));
  rendering = true;
  updateControls();
  if (direction) {
    stage.classList.remove('flip-next', 'flip-prev');
    void stage.offsetWidth;
    stage.classList.add(direction === 'next' ? 'flip-next' : 'flip-prev');
  }
  const pdfPage = await pdf.getPage(target);
  const base = pdfPage.getViewport({ scale: 1 });
  const maxWidth = Math.max(320, stage.clientWidth - 80);
  const maxHeight = Math.max(320, stage.clientHeight - 70);
  const scale = Math.min(maxWidth / base.width, maxHeight / base.height);
  const viewport = pdfPage.getViewport({ scale: Math.max(.4, scale) });
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  page = target;
  loading.hidden = true;
  rendering = false;
  updateControls();
}

prev.onclick = () => renderPage(page - 1, 'prev');
next.onclick = () => renderPage(page + 1, 'next');
window.addEventListener('resize', () => pdf && renderPage(page));
document.querySelector('#share').onclick = async () => {
  const url = location.href;
  try {
    if (navigator.share) await navigator.share({ title: document.title, url });
    else { await navigator.clipboard.writeText(url); alert('Link flipbook berhasil disalin.'); }
  } catch (e) { if (e.name !== 'AbortError') alert('Gagal membagikan link.'); }
};

(async () => {
  if (!id) { loading.textContent = 'Flipbook tidak ditemukan.'; return; }
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    pdf = await pdfjsLib.getDocument(`/api/media/${encodeURIComponent(id)}`).promise;
    await renderPage(1);
  } catch (err) {
    console.error(err);
    loading.textContent = 'Gagal membuka PDF.';
  }
})();