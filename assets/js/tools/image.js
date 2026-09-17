import { analytics } from '../analytics.js';
import { $, $$, icon, toast, download, loadImage, canvasToBlob, fmtBytes, makeDropZone } from '../utils.js';

// Lazy-loaded Cropper.js
let _cropperPromise = null;
function loadCropper() {
  if (!_cropperPromise) {
    _cropperPromise = import('https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/+esm')
      .then((m) => m.default || m.Cropper);
  }
  return _cropperPromise;
}

let _bgRemover = null;
function loadBgRemover() {
  if (!_bgRemover) {
    _bgRemover = import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm')
      .then((m) => m.removeBackground || (m.default && m.default.removeBackground));
  }
  return _bgRemover;
}

/* ============================================================
   Background Remover
   ============================================================ */
function renderBackgroundRemover(root, toolId) {
  let originalFile = null, resultBlob = null;
  root.innerHTML = `
    <div class="panel">
      <div id="brDrop"></div>
      <div id="brWorkspace" class="hidden">
        <div class="compare">
          <div><div class="cmp-label">Original</div><div class="cmp-box"><img id="brOrig" alt=""/></div></div>
          <div><div class="cmp-label">Result (transparent)</div><div class="cmp-box checker"><img id="brResult" alt=""/></div></div>
        </div>
        <div id="brStatus" class="hidden" style="margin-top:20px">
          <div class="status-row"><span class="label" id="brStatusText">Loading…</span><span class="pct" id="brPct">0%</span></div>
          <div class="progress"><div id="brBar"></div></div>
        </div>
        <div class="actions">
          <button id="brReset" class="btn btn-outline">Clear</button>
          <button id="brDownload" class="btn btn-primary hidden" disabled>${icon('download', 16)} Download PNG</button>
        </div>
      </div>
    </div>`;

  root.querySelector('#brDrop').appendChild(makeDropZone({
    accept: 'image/*', multiple: false,
    title: 'Drop an image here',
    hint: 'PNG, JPG, or WebP — processed on your device',
    onFiles: ([f]) => run(f),
  }));

  async function run(file) {
    originalFile = file; resultBlob = null;
    const ws = root.querySelector('#brWorkspace');
    const status = root.querySelector('#brStatus');
    const dl = root.querySelector('#brDownload');
    const bar = root.querySelector('#brBar');
    const pct = root.querySelector('#brPct');
    const label = root.querySelector('#brStatusText');
    ws.classList.remove('hidden'); status.classList.remove('hidden');
    dl.classList.add('hidden'); dl.disabled = true;
    bar.style.width = '5%'; pct.textContent = '5%'; label.textContent = 'Loading AI model…';
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
          label.textContent = key && key.startsWith('fetch') ? 'Downloading model…' : 'Removing background…';
        },
      });
      resultBlob = blob;
      root.querySelector('#brResult').src = URL.createObjectURL(blob);
      bar.style.width = '100%'; pct.textContent = '100%'; label.textContent = 'Done';
      dl.classList.remove('hidden'); dl.disabled = false;
      setTimeout(() => status.classList.add('hidden'), 1000);
      analytics.trackToolComplete(toolId); toast('Background removed', 'success');
    } catch (err) {
      console.error(err); analytics.trackError(toolId, err);
      status.classList.add('hidden'); toast('Background removal failed', 'error');
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

/* ============================================================
   Image Compressor
   ============================================================ */
function renderCompressor(root, toolId) {
  let items = [];
  root.innerHTML = `
    <div class="panel">
      <div id="icDrop"></div>
      <div class="field-group">
        <div class="field"><label>Quality <span id="icQVal">75%</span></label><input type="range" id="icQ" min="10" max="100" value="75"/></div>
        <div class="field"><label>Format</label><select id="icFmt"><option value="image/jpeg">JPEG</option><option value="image/webp" selected>WebP</option><option value="image/png">PNG</option></select></div>
        <button id="icRun" class="btn btn-primary">Compress</button>
        <button id="icZip" class="btn btn-outline" disabled>${icon('archive', 16)} ZIP</button>
      </div>
      <div id="icGrid" class="thumb-grid"></div>
    </div>`;
  root.querySelector('#icDrop').appendChild(makeDropZone({
    accept: 'image/*', multiple: true, title: 'Drop images to compress', hint: 'Batch processing',
    onFiles: (files) => { files.forEach((f) => items.push({ file: f, src: URL.createObjectURL(f), blob: null })); renderGrid(); },
  }));
  root.querySelector('#icQ').addEventListener('input', (e) => root.querySelector('#icQVal').textContent = e.target.value + '%');
  function renderGrid() {
    const grid = root.querySelector('#icGrid');
    grid.innerHTML = items.map((it, i) => `
      <div class="thumb"><img src="${it.src}" alt=""/>
        <button class="rm" data-i="${i}">${icon('x', 12)}</button>
        ${it.blob ? '<div class="done">' + fmtBytes(it.blob.size) + '</div>' : ''}
      </div>`).join('');
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

/* ============================================================
   Image Resizer (custom dimensions)
   ============================================================ */
function renderResizer(root, toolId) {
  let items = [];
  root.innerHTML = `
    <div class="panel">
      <div id="irDrop"></div>
      <div class="field-group">
        <div class="field"><label>Width (px)</label><input type="number" id="irW" value="1920" min="1"/></div>
        <div class="field"><label>Height (px)</label><input type="number" id="irH" value="1080" min="1"/></div>
        <label class="checkbox-row"><input type="checkbox" id="irLock" checked/> Keep aspect ratio</label>
        <button id="irRun" class="btn btn-primary">Resize</button>
        <button id="irZip" class="btn btn-outline" disabled>${icon('archive', 16)} ZIP</button>
      </div>
      <div id="irGrid" class="thumb-grid"></div>
    </div>`;
  root.querySelector('#irDrop').appendChild(makeDropZone({
    accept: 'image/*', multiple: true, title: 'Drop images to resize', hint: 'Batch processing',
    onFiles: (files) => { files.forEach((f) => items.push({ file: f, src: URL.createObjectURL(f), blob: null })); renderGrid(); },
  }));
  function renderGrid() {
    const grid = root.querySelector('#irGrid');
    grid.innerHTML = items.map((it, i) => `
      <div class="thumb"><img src="${it.src}" alt=""/>
        <button class="rm" data-i="${i}">${icon('x', 12)}</button>
        ${it.blob ? '<div class="done">Done</div>' : ''}
      </div>`).join('');
    grid.querySelectorAll('.rm').forEach((b) => b.addEventListener('click', () => { items.splice(+b.dataset.i, 1); renderGrid(); }));
    root.querySelector('#irZip').disabled = !items.some((i) => i.blob);
  }
  root.querySelector('#irRun').addEventListener('click', async () => {
    if (!items.length) return toast('No images', 'error');
    const W = +root.querySelector('#irW').value;
    const H = +root.querySelector('#irH').value;
    const lock = root.querySelector('#irLock').checked;
    analytics.trackToolStart(toolId);
    for (const it of items) {
      if (it.blob) continue;
      const img = await loadImage(it.src);
      let w = W, h = H;
      if (lock) {
        const ar = img.naturalWidth / img.naturalHeight;
        if (W / H > ar) w = Math.round(H * ar); else h = Math.round(W / ar);
      }
      const cvs = document.createElement('canvas');
      cvs.width = W; cvs.height = H;
      const ctx = cvs.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, Math.round((W - w) / 2), Math.round((H - h) / 2), w, h);
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

/* ============================================================
   Image Converter
   ============================================================ */
function renderConverter(root, toolId) {
  let items = [];
  root.innerHTML = `
    <div class="panel">
      <div id="cvDrop"></div>
      <div class="field-group">
        <div class="field"><label>Convert to</label><select id="cvFmt"><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option><option value="image/webp" selected>WebP</option></select></div>
        <div class="field"><label>Quality <span id="cvQVal">92%</span></label><input type="range" id="cvQ" min="10" max="100" value="92"/></div>
        <button id="cvRun" class="btn btn-primary">Convert</button>
        <button id="cvZip" class="btn btn-outline" disabled>${icon('archive', 16)} ZIP</button>
      </div>
      <div id="cvGrid" class="thumb-grid"></div>
    </div>`;
  root.querySelector('#cvDrop').appendChild(makeDropZone({
    accept: 'image/*', multiple: true, title: 'Drop images to convert', hint: 'PNG, JPG, WebP, GIF, BMP',
    onFiles: (files) => { files.forEach((f) => items.push({ file: f, src: URL.createObjectURL(f), blob: null })); renderGrid(); },
  }));
  root.querySelector('#cvQ').addEventListener('input', (e) => root.querySelector('#cvQVal').textContent = e.target.value + '%');
  function renderGrid() {
    const grid = root.querySelector('#cvGrid');
    grid.innerHTML = items.map((it, i) => `
      <div class="thumb"><img src="${it.src}" alt=""/>
        <button class="rm" data-i="${i}">${icon('x', 12)}</button>
        ${it.blob ? '<div class="done">' + fmtBytes(it.blob.size) + '</div>' : ''}
      </div>`).join('');
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

/* ============================================================
   Social Media Resizer (NEW) — Cropper.js + presets
   ============================================================ */
const SOCIAL_PRESETS = {
  'facebook-post':      { label: 'Facebook Post',       w: 1200, h: 630  },
  'facebook-cover':     { label: 'Facebook Cover',      w: 820,  h: 312  },
  'facebook-story':     { label: 'Facebook Story',      w: 1080, h: 1920 },
  'instagram-post':     { label: 'Instagram Post',      w: 1080, h: 1080 },
  'instagram-portrait': { label: 'Instagram Portrait',  w: 1080, h: 1350 },
  'instagram-story':    { label: 'Instagram Story/Reel', w: 1080, h: 1920 },
  'tiktok':             { label: 'TikTok',              w: 1080, h: 1920 },
  'youtube-thumbnail':  { label: 'YouTube Thumbnail',   w: 1280, h: 720  },
  'youtube-shorts':     { label: 'YouTube Shorts',      w: 1080, h: 1920 },
  'linkedin-post':      { label: 'LinkedIn Post',       w: 1200, h: 627  },
  'linkedin-banner':    { label: 'LinkedIn Banner',     w: 1584, h: 396  },
  'twitter-post':       { label: 'X / Twitter Post',    w: 1600, h: 900  },
  'pinterest-pin':      { label: 'Pinterest Pin',       w: 1000, h: 1500 },
  'custom':             { label: 'Custom dimensions',   w: 1080, h: 1080 },
};

function renderSocialResizer(root, toolId) {
  let cropper = null;
  let imageURL = null;

  root.innerHTML = `
    <div class="panel">
      <div id="srDrop"></div>
      <div id="srWorkspace" class="hidden">
        <div class="field-group">
          <div class="field">
            <label>Platform / format</label>
            <select id="srPreset">
              ${Object.entries(SOCIAL_PRESETS).map(([k, v]) => `<option value="${k}">${v.label} — ${v.w}×${v.h}</option>`).join('')}
            </select>
          </div>
          <div class="field sr-custom hidden" id="srCustomWrap">
            <label>Width × Height</label>
            <div style="display:flex;gap:8px">
              <input type="number" id="srW" value="1080" min="16" max="4096"/>
              <input type="number" id="srH" value="1080" min="16" max="4096"/>
            </div>
          </div>
          <button id="srReset" class="btn btn-outline">Reset crop</button>
          <button id="srExport" class="btn btn-primary">${icon('download', 16)} Export</button>
        </div>
        <div class="cropper-wrap">
          <img id="srImage" alt="Image to crop" />
        </div>
        <p class="crop-hint">Drag corners to resize. Drag the image to reposition. Use the mouse wheel to zoom.</p>
      </div>
    </div>`;

  root.querySelector('#srDrop').appendChild(makeDropZone({
    accept: 'image/*', multiple: false,
    title: 'Drop an image to resize',
    hint: 'Automatically cropped to the platform\'s correct aspect ratio',
    onFiles: ([file]) => load(file),
  }));

  const presetSel = root.querySelector('#srPreset');
  const customWrap = root.querySelector('#srCustomWrap');
  const srW = root.querySelector('#srW');
  const srH = root.querySelector('#srH');

  presetSel.addEventListener('change', async () => {
    customWrap.classList.toggle('hidden', presetSel.value !== 'custom');
    if (!cropper) return;
    const p = SOCIAL_PRESETS[presetSel.value];
    cropper.setAspectRatio(p.w / p.h);
  });
  [srW, srH].forEach((inp) => inp.addEventListener('input', () => {
    if (!cropper || presetSel.value !== 'custom') return;
    cropper.setAspectRatio(Math.max(1, +srW.value) / Math.max(1, +srH.value));
  }));

  async function load(file) {
    if (imageURL) URL.revokeObjectURL(imageURL);
    imageURL = URL.createObjectURL(file);
    root.querySelector('#srWorkspace').classList.remove('hidden');
    const img = root.querySelector('#srImage');
    img.src = imageURL;
    const Cropper = await loadCropper();
    if (cropper) cropper.destroy();
    cropper = new Cropper(img, {
      viewMode: 1,
      autoCropArea: 1,
      movable: true,
      zoomable: true,
      responsive: true,
      aspectRatio: SOCIAL_PRESETS[presetSel.value].w / SOCIAL_PRESETS[presetSel.value].h,
      background: false,
    });
    analytics.trackToolStart(toolId);
  }

  root.querySelector('#srReset').addEventListener('click', () => {
    if (cropper) { cropper.reset(); }
  });

  root.querySelector('#srExport').addEventListener('click', () => {
    if (!cropper) return;
    const p = presetSel.value === 'custom'
      ? { w: +srW.value, h: +srH.value }
      : SOCIAL_PRESETS[presetSel.value];
    const cvs = cropper.getCroppedCanvas({
      width: p.w,
      height: p.h,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });
    cvs.toBlob((blob) => {
      download(blob, `social_${presetSel.value}_${p.w}x${p.h}.png`);
      analytics.trackToolComplete(toolId);
      analytics.trackToolDownload(toolId);
      toast('Exported ' + p.w + '×' + p.h + ' PNG', 'success');
    }, 'image/png');
  });
}

export const IMAGE_TOOLS = {
  'background-remover': { name: 'Background Remover', render: renderBackgroundRemover },
  'compressor':         { name: 'Compressor',         render: renderCompressor },
  'resizer':            { name: 'Resizer',            render: renderResizer },
  'converter':          { name: 'Converter',          render: renderConverter },
  'social-resizer':     { name: 'Social Media Resizer', render: renderSocialResizer },
};