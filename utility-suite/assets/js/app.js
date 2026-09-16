import { analytics } from './analytics.js';
import * as auth from './auth.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function toast(msg, type = 'info', ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' err' : type === 'success' ? ' ok' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}
function fmtBytes(b) {
  if (!b) return '0 B';
  if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}
function download(blobOrUrl, filename) {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function loadImage(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  });
}
function canvasToBlob(cvs, type = 'image/png', q = 0.92) {
  return new Promise((r) => cvs.toBlob(r, type, q));
}
function icon(name, size = 20) {
  const paths = {
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    archive: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><line x1="10" y1="13" x2="14" y2="13"/>',
    arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  };
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || '') + '</svg>';
}

(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');
  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  });
})();

async function refreshAuthUI() {
  const pill = $('#authPill');
  const label = $('#authLabel');
  if (auth.isLoggedIn()) {
    pill.classList.add('on');
    label.textContent = 'Drive connected';
    pill.onclick = () => { auth.logout(); refreshAuthUI(); toast('Drive disconnected'); };
  } else {
    pill.classList.remove('on');
    label.textContent = 'Connect Drive';
    pill.onclick = () => auth.login();
  }
}
(async () => {
  if (await auth.handleCallback()) toast('Google Drive connected', 'success');
  refreshAuthUI();
})();

const TOOLS = [
  { id: 'background-remover', name: 'Background Remover', desc: 'Remove image backgrounds with AI, entirely in your browser. Transparent PNG output.',
    visual: '<div class="visual-bg-remover"><div class="half left"></div><div class="half right"></div><div class="subject"></div></div>',
    render: renderBackgroundRemover },
  { id: 'image-compressor', name: 'Image Compressor', desc: 'Shrink image file sizes dramatically while preserving visual quality.',
    visual: '<div class="visual-compressor"><div class="img"></div><div class="arrow">' + icon('download', 18) + '</div><div class="badge">−70%</div></div>',
    render: renderImageCompressor },
  { id: 'image-resizer', name: 'Image Resizer', desc: 'Resize images to exact pixel dimensions or common presets.',
    visual: '<div class="visual-resizer"><div class="img"></div><div class="handle tl"></div><div class="handle tr"></div><div class="handle bl"></div><div class="handle br"></div><div class="dims">1920 × 1080</div></div>',
    render: renderImageResizer },
  { id: 'image-converter', name: 'Image Converter', desc: 'Convert between PNG, JPEG, and WebP. Batch processing supported.',
    visual: '<div class="visual-converter"><span class="fmt">PNG</span><span class="arrow">→</span><span class="fmt to">WebP</span></div>',
    render: renderImageConverter },
  { id: 'pdf-creator', name: 'PDF Creator', desc: 'Combine images into a single PDF. Drag to reorder pages.',
    visual: '<div class="visual-pdf"><div class="page back"></div><div class="page mid"></div><div class="page front"><div class="line"></div><div class="line short"></div><div class="line"></div><div class="line short"></div></div><div class="badge">PDF</div></div>',
    render: renderPdfCreator },
  { id: 'grid-splitter', name: 'Instagram Grid Splitter', desc: 'Slice any image into 3×3, 6×6, or 9×9 tiles for a seamless Instagram feed.',
    visual: '<div class="visual-grid">' + Array.from({length:9}, (_, i) => '<div class="tile">' + (i+1) + '</div>').join('') + '</div>',
    render: renderGridSplitter },
];

function renderRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const name = hash.split('/')[0] || 'home';
  const main = $('#main');

  if (name === 'home') {
    analytics.trackPageview('home');
    main.innerHTML = '<section class="hero"><h1>Free tools that run in your browser</h1><p>No uploads. No sign-up. No tracking of your files. Everything is processed locally on your device.</p></section>' +
      '<section class="tool-grid">' +
        TOOLS.map((t) => '<a class="tool-card" href="#/' + t.id + '" data-tool="' + t.id + '"><div class="tool-visual">' + t.visual + '</div><div class="tool-body"><h3>' + t.name + '</h3><p>' + t.desc + '</p><span class="tool-arrow">Open tool →</span></div></a>').join('') +
      '</section>';
    $$('.tool-card').forEach((card) => card.addEventListener('click', () => {
      analytics.trackToolOpen(card.dataset.tool);
    }));
    return;
  }

  const tool = TOOLS.find((t) => t.id === name);
  if (!tool) {
    main.innerHTML = '<div class="empty-state"><h2>Not found</h2><p><a href="#/">Return home</a></p></div>';
    return;
  }
  main.innerHTML = '<a class="back-link" href="#/">' + icon('arrowLeft', 14) + ' Back to all tools</a><div class="tool-page"><div class="tool-header"><h2>' + tool.name + '</h2><p>' + tool.desc + '</p></div><div id="toolRoot"></div></div>';
  analytics.trackPageview('tool/' + tool.id);
  tool.render($('#toolRoot'), tool.id);
}
window.addEventListener('hashchange', renderRoute);
renderRoute();

function makeDropZone({ accept, multiple, onFiles, title, hint }) {
  const el = document.createElement('div');
  el.className = 'drop-zone';
  el.tabIndex = 0;
  el.innerHTML = icon('upload', 40) + '<div class="dz-title">' + title + '</div><div class="dz-hint">' + hint + '</div><input type="file" class="hidden" ' + (multiple ? 'multiple' : '') + ' accept="' + accept + '" />';
  const input = el.querySelector('input');
  el.addEventListener('click', () => input.click());
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag'));
  el.addEventListener('drop', (e) => {
    e.preventDefault(); el.classList.remove('drag');
    const files = [...e.dataTransfer.files].filter((f) => matchesAccept(f, accept));
    if (files.length) onFiles(files); else toast('Unsupported file type', 'error');
  });
  input.addEventListener('change', (e) => {
    const files = [...e.target.files];
    if (files.length) onFiles(files);
    e.target.value = '';
  });
  return el;
}
function matchesAccept(file, accept) {
  if (!accept) return true;
  return accept.split(',').some((rule) => {
    rule = rule.trim();
    if (rule === 'image/*') return file.type.startsWith('image/');
    return file.type === rule;
  });
}

let bgRemoverModule = null;
async function loadBgRemover() {
  if (!bgRemoverModule) {
    bgRemoverModule = import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm')
      .then((m) => m.removeBackground || (m.default && m.default.removeBackground));
  }
  return bgRemoverModule;
}

function renderBackgroundRemover(root, toolId) {
  let originalFile = null, resultBlob = null;
  root.innerHTML = '<div class="panel"><div id="brDrop"></div><div id="brWorkspace" class="hidden"><div class="compare"><div><div class="cmp-label">Original</div><div class="cmp-box"><img id="brOrig" alt="Original" /></div></div><div><div class="cmp-label">Result</div><div class="cmp-box checker"><img id="brResult" alt="Result" /></div></div></div><div id="brStatus" class="hidden" style="margin-top:20px"><div class="status-row"><span class="label" id="brStatusText">Loading…</span><span class="pct" id="brPct">0%</span></div><div class="progress"><div id="brBar"></div></div></div><div class="actions"><button id="brReset" class="btn btn-outline">Clear</button><button id="brDownload" class="btn btn-primary hidden" disabled>' + icon('download', 16) + ' Download PNG</button></div></div></div>';
  root.querySelector('#brDrop').appendChild(makeDropZone({ accept: 'image/*', multiple: false, title: 'Drop an image here', hint: 'PNG, JPG, or WebP — processed on your device', onFiles: ([f]) => run(f) }));

  async function run(file) {
    originalFile = file; resultBlob = null;
    const ws = root.querySelector('#brWorkspace'), status = root.querySelector('#brStatus'), dl = root.querySelector('#brDownload');
    const bar = root.querySelector('#brBar'), pct = root.querySelector('#brPct'), label = root.querySelector('#brStatusText');
    ws.classList.remove('hidden'); status.classList.remove('hidden');
    dl.classList.add('hidden'); dl.disabled = true;
    bar.style.width = '5%'; pct.textContent = '5%';
    label.textContent = 'Loading AI model…';
    root.querySelector('#brOrig').src = URL.createObjectURL(file);
    root.querySelector('#brResult').src = '';
    analytics.trackToolStart(toolId);
    try {
      const removeBackground = await loadBgRemover();
      label.textContent = 'Removing background…';
      const blob = await removeBackground(file, {
        progress: (key, cur, total) => {
          const p = Math.max(5, Math.min(99, Math.round((cur / total) * 100)));
          bar.style.width = p + '%'; pct.textContent = p + '%';
        },
      });
      resultBlob = blob;
      root.querySelector('#brResult').src = URL.createObjectURL(blob);
      bar.style.width = '100%'; pct.textContent = '100%'; label.textContent = 'Done';
      dl.classList.remove('hidden'); dl.disabled = false;
      setTimeout(() => status.classList.add('hidden'), 1000);
      analytics.trackToolComplete(toolId);
      toast('Background removed', 'success');
    } catch (err) {
      console.error(err); analytics.trackError(toolId, err);
      status.classList.add('hidden');
      toast('Background removal failed', 'error');
    }
  }
  root.querySelector('#brReset').addEventListener('click', () => {
    originalFile = null; resultBlob = null;
    root.querySelector('#brWorkspace').classList.add('hidden');
  });
  root.querySelector('#brDownload').addEventListener('click', () => {
    if (!resultBlob || !originalFile) return;
    download(resultBlob, originalFile.name.replace(/\.[^.]+$/, '') + '_no-bg.png');
    analytics.trackToolDownload(toolId);
  });
}

function renderImageCompressor(root, toolId) {
  let items = [];
  root.innerHTML = '<div class="panel"><div id="icDrop"></div><div class="field-group"><div class="field"><label>Quality <span id="icQVal">75%</span></label><input type="range" id="icQ" min="10" max="100" value="75" /></div><div class="field"><label>Format</label><select id="icFmt"><option value="image/jpeg">JPEG</option><option value="image/webp" selected>WebP</option><option value="image/png">PNG</option></select></div><button id="icRun" class="btn btn-primary">Compress</button><button id="icZip" class="btn btn-outline" disabled>' + icon('archive', 16) + ' ZIP</button></div><div id="icGrid" class="thumb-grid"></div></div>';
  root.querySelector('#icDrop').appendChild(makeDropZone({ accept: 'image/*', multiple: true, title: 'Drop images to compress', hint: 'Batch processing', onFiles: (files) => { files.forEach((file) => items.push({ file, src: URL.createObjectURL(file), blob: null })); renderGrid(); } }));
  root.querySelector('#icQ').addEventListener('input', (e) => root.querySelector('#icQVal').textContent = e.target.value + '%');

  function renderGrid() {
    const grid = root.querySelector('#icGrid');
    grid.innerHTML = items.map((it, i) => '<div class="thumb"><img src="' + it.src + '"/><button class="rm" data-i="' + i + '">' + icon('x', 12) + '</button>' + (it.blob ? '<div class="done">' + fmtBytes(it.blob.size) + '</div>' : '') + '</div>').join('');
    grid.querySelectorAll('.rm').forEach((b) => b.addEventListener('click', () => { items.splice(+b.dataset.i, 1); renderGrid(); }));
    root.querySelector('#icZip').disabled = !items.some((i) => i.blob);
  }

  root.querySelector('#icRun').addEventListener('click', async () => {
    if (!items.length) return toast('No images', 'error');
    const q = +root.querySelector('#icQ').value / 100;
    const fmt = root.querySelector('#icFmt').value;
    analytics.trackToolStart(toolId);
    for (const it of items) {
      if (it.blob) continue;
      const img = await loadImage(it.src);
      const cvs = document.createElement('canvas');
      cvs.width = img.naturalWidth; cvs.height = img.naturalHeight;
      const ctx = cvs.getContext('2d');
      if (fmt === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cvs.width, cvs.height); }
      ctx.drawImage(img, 0, 0);
      it.blob = await canvasToBlob(cvs, fmt, fmt === 'image/png' ? undefined : q);
    }
    renderGrid(); analytics.trackToolComplete(toolId); toast('Compressed', 'success');
  });
  root.querySelector('#icZip').addEventListener('click', async () => {
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    const zip = new JSZip();
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[root.querySelector('#icFmt').value];
    items.forEach((it) => { if (it.blob) zip.file(it.file.name.replace(/\.[^.]+$/, '') + '.' + ext, it.blob); });
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, 'compressed.zip'); analytics.trackToolDownload(toolId);
  });
}

function renderImageResizer(root, toolId) {
  let items = [];
  root.innerHTML = '<div class="panel"><div id="irDrop"></div><div class="field-group"><div class="field"><label>Width</label><input type="number" id="irW" value="1920"/></div><div class="field"><label>Height</label><input type="number" id="irH" value="1080"/></div><button id="irRun" class="btn btn-primary">Resize</button><button id="irZip" class="btn btn-outline" disabled>' + icon('archive', 16) + ' ZIP</button></div><div id="irGrid" class="thumb-grid"></div></div>';
  root.querySelector('#irDrop').appendChild(makeDropZone({ accept: 'image/*', multiple: true, title: 'Drop images to resize', hint: 'Batch processing', onFiles: (files) => { files.forEach((file) => items.push({ file, src: URL.createObjectURL(file), blob: null })); renderGrid(); } }));
  function renderGrid() {
    const grid = root.querySelector('#irGrid');
    grid.innerHTML = items.map((it, i) => '<div class="thumb"><img src="' + it.src + '"/><button class="rm" data-i="' + i + '">' + icon('x', 12) + '</button>' + (it.blob ? '<div class="done">Done</div>' : '') + '</div>').join('');
    grid.querySelectorAll('.rm').forEach((b) => b.addEventListener('click', () => { items.splice(+b.dataset.i, 1); renderGrid(); }));
    root.querySelector('#irZip').disabled = !items.some((i) => i.blob);
  }
  root.querySelector('#irRun').addEventListener('click', async () => {
    if (!items.length) return toast('No images', 'error');
    const W = +root.querySelector('#irW').value, H = +root.querySelector('#irH').value;
    analytics.trackToolStart(toolId);
    for (const it of items) {
      if (it.blob) continue;
      const img = await loadImage(it.src);
      const cvs = document.createElement('canvas');
      cvs.width = W; cvs.height = H;
      cvs.getContext('2d').drawImage(img, 0, 0, W, H);
      it.blob = await canvasToBlob(cvs, 'image/png');
    }
    renderGrid(); analytics.trackToolComplete(toolId); toast('Resized', 'success');
  });
  root.querySelector('#irZip').addEventListener('click', async () => {
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    const zip = new JSZip();
    items.forEach((it) => { if (it.blob) zip.file(it.file.name.replace(/\.[^.]+$/, '') + '.png', it.blob); });
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, 'resized.zip'); analytics.trackToolDownload(toolId);
  });
}

function renderImageConverter(root, toolId) {
  let items = [];
  root.innerHTML = '<div class="panel"><div id="cvDrop"></div><div class="field-group"><div class="field"><label>Convert to</label><select id="cvFmt"><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option><option value="image/webp" selected>WebP</option></select></div><div class="field"><label>Quality <span id="cvQVal">92%</span></label><input type="range" id="cvQ" min="10" max="100" value="92"/></div><button id="cvRun" class="btn btn-primary">Convert</button><button id="cvZip" class="btn btn-outline" disabled>' + icon('archive', 16) + ' ZIP</button></div><div id="cvGrid" class="thumb-grid"></div></div>';
  root.querySelector('#cvDrop').appendChild(makeDropZone({ accept: 'image/*', multiple: true, title: 'Drop images to convert', hint: 'PNG, JPG, WebP, GIF, BMP', onFiles: (files) => { files.forEach((file) => items.push({ file, src: URL.createObjectURL(file), blob: null })); renderGrid(); } }));
  root.querySelector('#cvQ').addEventListener('input', (e) => root.querySelector('#cvQVal').textContent = e.target.value + '%');
  function renderGrid() {
    const grid = root.querySelector('#cvGrid');
    grid.innerHTML = items.map((it, i) => '<div class="thumb"><img src="' + it.src + '"/><button class="rm" data-i="' + i + '">' + icon('x', 12) + '</button>' + (it.blob ? '<div class="done">' + fmtBytes(it.blob.size) + '</div>' : '') + '</div>').join('');
    grid.querySelectorAll('.rm').forEach((b) => b.addEventListener('click', () => { items.splice(+b.dataset.i, 1); renderGrid(); }));
    root.querySelector('#cvZip').disabled = !items.some((i) => i.blob);
  }
  root.querySelector('#cvRun').addEventListener('click', async () => {
    if (!items.length) return toast('No images', 'error');
    const fmt = root.querySelector('#cvFmt').value;
    const q = +root.querySelector('#cvQ').value / 100;
    analytics.trackToolStart(toolId);
    for (const it of items) {
      if (it.blob) continue;
      const img = await loadImage(it.src);
      const cvs = document.createElement('canvas');
      cvs.width = img.naturalWidth; cvs.height = img.naturalHeight;
      const ctx = cvs.getContext('2d');
      if (fmt === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cvs.width, cvs.height); }
      ctx.drawImage(img, 0, 0);
      it.blob = await canvasToBlob(cvs, fmt, fmt === 'image/png' ? undefined : q);
    }
    renderGrid(); analytics.trackToolComplete(toolId); toast('Converted', 'success');
  });
  root.querySelector('#cvZip').addEventListener('click', async () => {
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    const zip = new JSZip();
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[root.querySelector('#cvFmt').value];
    items.forEach((it) => { if (it.blob) zip.file(it.file.name.replace(/\.[^.]+$/, '') + '.' + ext, it.blob); });
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, 'converted.zip'); analytics.trackToolDownload(toolId);
  });
}

function renderPdfCreator(root, toolId) {
  let images = [];
  root.innerHTML = '<div class="panel"><div id="pdfDrop"></div><ul id="pdfList" style="list-style:none;display:flex;flex-wrap:wrap;gap:10px;margin-top:20px"></ul><div class="actions"><button id="pdfClear" class="btn btn-outline hidden">Clear</button><button id="pdfGo" class="btn btn-primary hidden">' + icon('file', 16) + ' Generate PDF</button></div></div>';
  root.querySelector('#pdfDrop').appendChild(makeDropZone({ accept: 'image/*', multiple: true, title: 'Drop images to build a PDF', hint: 'Drag thumbnails to reorder', onFiles: (files) => {
    files.forEach((file) => {
      const r = new FileReader();
      r.onload = (e) => { images.push({ name: file.name, src: e.target.result }); renderList(); };
      r.readAsDataURL(file);
    });
  }}));
  function renderList() {
    const list = root.querySelector('#pdfList');
    list.innerHTML = images.map((img, i) => '<li data-i="' + i + '" style="width:96px;height:96px;border-radius:10px;overflow:hidden;border:1px solid var(--border);position:relative;background:var(--surface-2)"><img src="' + img.src + '" style="width:100%;height:100%;object-fit:cover"/><button class="rm" data-i="' + i + '" style="position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,0.6);color:#fff;border:none">' + icon('x', 10) + '</button></li>').join('');
    const has = images.length > 0;
    root.querySelector('#pdfGo').classList.toggle('hidden', !has);
    root.querySelector('#pdfClear').classList.toggle('hidden', !has);
    list.querySelectorAll('.rm').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); images.splice(+b.dataset.i, 1); renderList(); }));
  }
  root.querySelector('#pdfClear').addEventListener('click', () => { images = []; renderList(); });
  root.querySelector('#pdfGo').addEventListener('click', async () => {
    if (!images.length) return;
    const btn = root.querySelector('#pdfGo');
    btn.disabled = true; btn.textContent = 'Building…';
    analytics.trackToolStart(toolId);
    try {
      const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      for (let i = 0; i < images.length; i++) {
        if (i > 0) doc.addPage();
        const props = doc.getImageProperties(images[i].src);
        const ratio = Math.min(pw / props.width, ph / props.height) * 0.92;
        doc.addImage(images[i].src, 'JPEG', (pw - props.width * ratio) / 2, (ph - props.height * ratio) / 2, props.width * ratio, props.height * ratio);
      }
      doc.save('document.pdf');
      analytics.trackToolComplete(toolId); analytics.trackToolDownload(toolId);
      toast('PDF saved', 'success');
    } catch (err) { console.error(err); analytics.trackError(toolId, err); toast('Could not build PDF', 'error'); }
    btn.disabled = false; btn.innerHTML = icon('file', 16) + ' Generate PDF';
  });
}

function renderGridSplitter(root, toolId) {
  let sourceImg = null, tiles = [], gridN = 3;
  root.innerHTML = '<div class="panel"><div id="gsDrop"></div><div id="gsWorkspace" class="hidden"><div class="field-group"><div class="field"><label>Grid size</label><select id="gsSize"><option value="2">2 × 2</option><option value="3" selected>3 × 3</option><option value="6">6 × 6</option><option value="9">9 × 9</option></select></div><button id="gsZip" class="btn btn-outline">' + icon('archive', 16) + ' ZIP</button><button id="gsAll" class="btn btn-primary">' + icon('download', 16) + ' Download Tiles</button></div><div style="margin:20px 0;padding:14px;background:var(--surface-2);border-radius:10px;font-size:13.5px;color:var(--text-2)"><b style="color:var(--text)">Instagram tip:</b> Post tiles in <b>reverse order</b> (highest number first).</div><div id="gsPreview" class="split-grid"></div></div></div>';
  root.querySelector('#gsDrop').appendChild(makeDropZone({ accept: 'image/*', multiple: false, title: 'Drop an image to split', hint: 'Center-cropped to square', onFiles: ([file]) => load(file) }));
  async function load(file) {
    sourceImg = await loadImage(file);
    root.querySelector('#gsWorkspace').classList.remove('hidden');
    build();
    analytics.trackToolStart(toolId);
  }
  function build() {
    const n = gridN;
    const size = Math.min(sourceImg.naturalWidth, sourceImg.naturalHeight);
    const sx = (sourceImg.naturalWidth - size) / 2;
    const sy = (sourceImg.naturalHeight - size) / 2;
    const tileSize = Math.floor(size / n);
    tiles = [];
    const preview = root.querySelector('#gsPreview');
    preview.style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';
    preview.innerHTML = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cvs = document.createElement('canvas');
        cvs.width = tileSize; cvs.height = tileSize;
        cvs.getContext('2d').drawImage(sourceImg, sx + c * tileSize, sy + r * tileSize, tileSize, tileSize, 0, 0, tileSize, tileSize);
        const index = r * n + c;
        tiles.push({ index, canvas: cvs });
        const img = document.createElement('img');
        img.src = cvs.toDataURL('image/jpeg', 0.92);
        preview.appendChild(img);
      }
    }
    analytics.trackToolComplete(toolId);
  }
  root.querySelector('#gsSize').addEventListener('change', (e) => { gridN = +e.target.value; if (sourceImg) build(); });
  root.querySelector('#gsAll').addEventListener('click', () => {
    if (!tiles.length) return;
    tiles.forEach((t, i) => {
      setTimeout(() => {
        const num = String(t.index + 1).padStart(3, '0');
        download(t.canvas.toDataURL('image/jpeg', 0.92), gridN + 'x' + gridN + '_' + num + '.jpg');
      }, i * 120);
    });
    analytics.trackToolDownload(toolId);
    toast('Downloading tiles', 'success');
  });
  root.querySelector('#gsZip').addEventListener('click', async () => {
    if (!tiles.length) return;
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    const zip = new JSZip();
    const folder = zip.folder('instagram_' + gridN + 'x' + gridN);
    tiles.forEach((t) => {
      const num = String(t.index + 1).padStart(3, '0');
      folder.file(num + '.jpg', t.canvas.toDataURL('image/jpeg', 0.92).split(',')[1], { base64: true });
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, 'instagram_' + gridN + 'x' + gridN + '.zip');
    analytics.trackToolDownload(toolId);
  });
}