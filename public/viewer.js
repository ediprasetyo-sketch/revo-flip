const params = new URLSearchParams(location.search);
const directId = params.get('id');
const shareToken = params.get('share');
const stage = document.querySelector('#bookStage');
const flipbook = document.querySelector('#flipbook');
const loading = document.querySelector('#loadingOverlay');
const loadingMessage = document.querySelector('#loadingMessage');
const loadingSubtext = document.querySelector('#loadingSubtext');
const loadingProgressBar = document.querySelector('#loadingProgressBar');
const orientationOverlay = document.querySelector('#orientationOverlay');
const prev = document.querySelector('#prev');
const next = document.querySelector('#next');
const label = document.querySelector('#pageLabel');
const share = document.querySelector('#share');
const deleteButton = document.querySelector('#delete');

let pdf;
let bookId = directId;
let resizeTimer;
let turnReady = false;
let pageW = 0;
let pageH = 0;

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.matchMedia('(pointer:coarse)').matches;
}

function updateOrientationOverlay() {
  const portrait = window.innerHeight > window.innerWidth;
  const show = isMobileDevice() && portrait && turnReady;
  orientationOverlay.hidden = !show;
}

function setLoading(message, subtext = '', progress = 0, visible = true) {
  loading.hidden = !visible;
  if (message) loadingMessage.textContent = message;
  if (subtext) loadingSubtext.textContent = subtext;
  loadingProgressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function controls() {
  if (!turnReady || !pdf) return;
  const current = $('#flipbook').turn('page');
  label.textContent = `${current} / ${pdf.numPages}`;
  prev.disabled = current <= 1;
  next.disabled = current >= pdf.numPages;
}

function fitSize() {
  const w = Math.max(320, stage.clientWidth - 72);
  const h = Math.max(260, stage.clientHeight - 72);
  const ratio = pageW / pageH;
  let singleW = Math.min(w / 2, h * ratio);
  let singleH = singleW / ratio;
  if (pdf.numPages === 1) {
    singleW = Math.min(w, h * ratio);
    singleH = singleW / ratio;
  }
  return { w: Math.max(1, Math.floor(singleW)), h: Math.max(1, Math.floor(singleH)) };
}

async function renderPage(number, width, height) {
  const page = await pdf.getPage(number);
  const source = page.getViewport({ scale: 1 });
  const scale = Math.min(width / source.width, height / source.height);
  const viewport = page.getViewport({ scale });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const offsetX = (width - viewport.width) / 2;
  const offsetY = (height - viewport.height) / 2;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  await page.render({ canvasContext: ctx, viewport }).promise;
  ctx.restore();
  page.cleanup();
  return canvas;
}

async function buildBook(keepPage = 1, showProgress = true) {
  const first = await pdf.getPage(1);
  const firstViewport = first.getViewport({ scale: 1 });
  pageW = firstViewport.width;
  pageH = firstViewport.height;
  first.cleanup();
  const size = fitSize();
  flipbook.innerHTML = '';
  if (showProgress) setLoading('Membuka buku...', 'Menyesuaikan ukuran halaman... 75%', 75, true);

  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = document.createElement('div');
    page.className = 'page';
    page.dataset.page = String(number);
    page.style.width = `${size.w}px`;
    page.style.height = `${size.h}px`;
    flipbook.appendChild(page);
    const percent = 75 + Math.round((number / pdf.numPages) * 25);
    if (showProgress) setLoading('Membuka buku...', `Menyiapkan halaman... ${percent}%`, percent, true);
    try {
      const canvas = await renderPage(number, size.w, size.h);
      page.appendChild(canvas);
    } catch (error) {
      console.error(`PDF page ${number} failed`, error);
      throw new Error(`Gagal memuat halaman ${number} dari PDF.`);
    }
  }

  if (showProgress) setLoading('Membuka buku...', 'Menyelesaikan tampilan...', 100, true);
  $('#flipbook').turn({
    width: pdf.numPages === 1 ? size.w : size.w * 2,
    height: size.h,
    autoCenter: true,
    display: pdf.numPages === 1 ? 'single' : 'double',
    duration: 950,
    gradients: true,
    elevation: 50,
    acceleration: true,
    when: {
      turning: (event, targetPage) => {
        if (targetPage < 1 || targetPage > pdf.numPages) { event.preventDefault(); return false; }
      },
      turned: () => controls()
    }
  });

  turnReady = true;
  $('#flipbook').turn('page', Math.max(1, Math.min(keepPage, pdf.numPages)));
  controls();
  updateOrientationOverlay();
  if (showProgress) setTimeout(() => setLoading('', '', 100, false), 220);
}

async function rebuildKeepPage() {
  if (!pdf || !turnReady) return;
  const current = $('#flipbook').turn('page');
  turnReady = false;
  try { $('#flipbook').turn('destroy'); } catch (_) {}
  await buildBook(current, false);
}

function showError(error) {
  console.error(error);
  turnReady = false;
  updateOrientationOverlay();
  const message = error?.message || 'Gagal membuka flipbook.';
  setLoading(message === 'Link sudah kedaluwarsa atau tidak valid' ? 'Link ini sudah kedaluwarsa.' : message, 'Silakan coba lagi.', 0, true);
}

prev.addEventListener('click', () => { if (turnReady) $('#flipbook').turn('previous'); });
next.addEventListener('click', () => { if (turnReady) $('#flipbook').turn('next'); });

share.addEventListener('click', async () => {
  const original = share.innerHTML;
  share.disabled = true;
  try {
    const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/share`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Gagal membuat link');
    const url = new URL(data.viewer, location.origin).href;
    const expiry = new Date(data.expiresAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    if (navigator.share) await navigator.share({ title: document.title, text: `Link aktif sampai ${expiry}`, url });
    else await navigator.clipboard.writeText(url);
    share.innerHTML = '✓ <span>Link aktif 24 jam</span>';
    setTimeout(() => { share.innerHTML = original; }, 2200);
  } catch (error) {
    if (error.name !== 'AbortError') alert(error.message || 'Gagal membagikan link.');
  } finally { share.disabled = false; }
});

if (directId) {
  deleteButton.hidden = false;
  deleteButton.addEventListener('click', async () => {
    if (!confirm('Hapus flipbook ini? File PDF dan link bagikan akan dihapus permanen.')) return;
    const original = deleteButton.innerHTML;
    deleteButton.disabled = true;
    deleteButton.innerHTML = '… <span>Menghapus</span>';
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Gagal menghapus flipbook');
      location.href = '/';
    } catch (error) {
      alert(error.message || 'Gagal menghapus flipbook.');
      deleteButton.disabled = false;
      deleteButton.innerHTML = original;
    }
  });
}

window.addEventListener('resize', () => {
  updateOrientationOverlay();
  if (!pdf || !turnReady) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => rebuildKeepPage().catch(showError), 250);
});
window.addEventListener('orientationchange', () => setTimeout(updateOrientationOverlay, 120));

(async () => {
  try {
    if (shareToken) {
      const response = await fetch(`/api/share/${encodeURIComponent(shareToken)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Link tidak valid');
      bookId = data.id;
      document.title = data.title ? `${data.title} — Revo Learning Flip` : document.title;
    } else if (!bookId) throw new Error('Flipbook tidak ditemukan.');

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const media = `/api/media/${encodeURIComponent(bookId)}${shareToken ? `?share=${encodeURIComponent(shareToken)}` : ''}`;
    setLoading('Membuka buku...', 'Menyiapkan halaman... 10%', 10, true);
    const response = await fetch(media, { cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `Gagal mengambil PDF (${response.status}).`);
    }
    setLoading('Membuka buku...', 'Menyiapkan halaman... 35%', 35, true);
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new Error('File PDF kosong atau tidak dapat dibaca.');
    setLoading('Membuka buku...', 'Menyiapkan halaman... 70%', 70, true);
    pdf = await pdfjsLib.getDocument({ data: bytes, disableRange: true, disableStream: true }).promise;
    if (!pdf.numPages) throw new Error('PDF tidak memiliki halaman.');
    await buildBook(1, true);
  } catch (error) { showError(error); }
})();
