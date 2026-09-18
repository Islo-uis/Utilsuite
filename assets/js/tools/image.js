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

// Lazy-loaded background removal AI
let _bgRemover = null;
function loadBgRemover() {
  if (!_bgRemover) {
    _bgRemover = import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm')
      .then((m) => m.removeBackground || (m.default && m.default.removeBackground));
  }
  return _bgRemover;
}

// Lazy-loaded QRious (UMD — loaded via <script> tag, not ESM import)
async function loadQRious() {
  if (window.QRious) return window.QRious;
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-qrious]');
    if (existing) {
      existing.addEventListener('load', () => window.QRious ? resolve(window.QRious) : reject(new Error('QRious failed')));
      existing.addEventListener('error', () => reject(new Error('QRious failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js';
    s.dataset.qrious = '1';
    s.onload = () => window.QRious ? resolve(window.QRious) : reject(new Error('QRious failed'));
    s.onerror = () => reject(new Error('QRious failed to load'));
    document.head.appendChild(s);
  });
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
   Social Media Resizer — Cropper.js + presets
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

/* ============================================================
   QR Code Generator
   ============================================================ */
function renderQRGenerator(root, toolId) {
  root.innerHTML = `
    <div class="panel">
      <div class="field-row"><label>Content (URL, text, or anything)</label>
        <textarea id="qrText" placeholder="https://example.com">https://example.com</textarea>
      </div>
      <div class="tool-row">
        <div class="field-row"><label>Size (px)</label><input type="number" id="qrSize" value="400" min="100" max="2000"/></div>
        <div class="field-row"><label>Foreground</label><input type="color" id="qrFg" value="#0f172a"/></div>
        <div class="field-row"><label>Background</label><input type="color" id="qrBg" value="#ffffff"/></div>
      </div>
      <div style="display:grid;place-items:center;margin:20px 0">
        <canvas id="qrCanvas" style="max-width:280px"></canvas>
      </div>
      <div class="actions">
        <button id="qrSave" class="btn btn-primary">${icon('download', 16)} Download PNG</button>
      </div>
    </div>`;

  let qr = null;
  let loading = false;

  const update = async () => {
    const text = root.querySelector('#qrText').value || ' ';
    const size = +root.querySelector('#qrSize').value;
    const fg = root.querySelector('#qrFg').value;
    const bg = root.querySelector('#qrBg').value;

    if (!qr) {
      if (loading) return;
      loading = true;
      try {
        const QRious = await loadQRious();
        qr = new QRious({
          element: root.querySelector('#qrCanvas'),
          size, value: text, foreground: fg, background: bg,
        });
      } catch (e) {
        console.error(e);
        toast('QR library failed to load', 'error');
        loading = false;
        return;
      }
      loading = false;
    } else {
      qr.value = text;
      qr.size = size;
      qr.foreground = fg;
      qr.background = bg;
    }
    analytics.trackToolStart(toolId);
  };

  root.querySelectorAll('input, textarea').forEach((el) => el.addEventListener('input', update));
  update();

  root.querySelector('#qrSave').addEventListener('click', () => {
    if (!qr) return toast('QR not ready yet', 'error');
    const a = document.createElement('a');
    a.href = root.querySelector('#qrCanvas').toDataURL();
    a.download = 'qr-code.png';
    a.click();
    analytics.trackToolComplete(toolId);
    analytics.trackToolDownload(toolId);
  });
}
/* ============================================================
   SVG → Image (rasterize)
   ============================================================ */
function renderSvgToImage(root, toolId) {
  let svgFile = null;
  let svgText = null;

  root.innerHTML = `
    <div class="panel">
      <div id="svDrop"></div>
      <div class="format-note" style="margin-top:16px">
        <b>Supported:</b> .svg files. Rasterized in your browser at any size — exports PNG, JPEG, or WebP.
      </div>
      <div id="svWorkspace" class="hidden">
        <div class="inv-grid" style="margin-top:16px">
          <div class="field-row"><label>Width (px)</label><input type="number" id="svW" value="1024" min="16" max="8192"/></div>
          <div class="field-row"><label>Height (px)</label><input type="number" id="svH" value="1024" min="16" max="8192"/></div>
          <div class="field-row"><label>Format</label>
            <select id="svFmt">
              <option value="image/png" selected>PNG (transparent)</option>
              <option value="image/jpeg">JPEG</option>
              <option value="image/webp">WebP</option>
            </select>
          </div>
          <div class="field-row"><label>Background (for JPEG)</label><input type="color" id="svBg" value="#ffffff"/></div>
          <div class="field-row"><label>&nbsp;</label><label class="checkbox-row"><input type="checkbox" id="svLock" checked/> Lock aspect ratio</label></div>
        </div>
        <div class="compare" style="margin-top:20px">
          <div>
            <div class="cmp-label">Source</div>
            <div class="cmp-box checker" id="svPreviewWrap"></div>
          </div>
          <div>
            <div class="cmp-label">Rasterized preview</div>
            <div class="cmp-box checker"><img id="svRaster" alt="Rasterized"/></div>
          </div>
        </div>
        <div class="actions">
          <button id="svReset" class="btn btn-outline">Clear</button>
          <button id="svExport" class="btn btn-primary">${icon('download', 16)} Export</button>
        </div>
      </div>
    </div>`;

  root.querySelector('#svDrop').appendChild(makeDropZone({
    accept: '.svg,image/svg+xml', multiple: false,
    title: 'Drop an SVG file',
    hint: 'Rasterize to PNG, JPEG, or WebP at any resolution',
    onFiles: ([f]) => load(f),
  }));

  const svW = root.querySelector('#svW');
  const svH = root.querySelector('#svH');
  const lock = root.querySelector('#svLock');
  let naturalW = 512, naturalH = 512;

  async function load(file) {
    svgFile = file;
    svgText = await file.text();
    const match = /viewBox\s*=\s*["']([^"']+)["']/.exec(svgText);
    const wm = /\swidth\s*=\s*["'](\d+)/.exec(svgText);
    const hm = /\sheight\s*=\s*["'](\d+)/.exec(svgText);
    if (match) {
      const parts = match[1].split(/\s+/).map(Number);
      if (parts.length === 4) { naturalW = parts[2]; naturalH = parts[3]; }
    } else if (wm && hm) { naturalW = +wm[1]; naturalH = +hm[1]; }
    svW.value = naturalW;
    svH.value = naturalH;

    root.querySelector('#svWorkspace').classList.remove('hidden');
    // Render source into preview
    const prevWrap = root.querySelector('#svPreviewWrap');
    prevWrap.innerHTML = '';
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      img.style.maxWidth = '100%';
      img.style.maxHeight = '300px';
      prevWrap.appendChild(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
    rasterizePreview();
    analytics.trackToolStart(toolId);
  }

  async function rasterizeBlob() {
    const W = Math.max(1, +svW.value);
    const H = Math.max(1, +svH.value);
    const fmt = root.querySelector('#svFmt').value;
    const bg = root.querySelector('#svBg').value;

    // Ensure the SVG has explicit width/height before rasterizing
    let prepared = svgText;
    if (!/\swidth\s*=/.test(prepared)) prepared = prepared.replace('<svg', `<svg width="${W}" height="${H}"`);
    if (!/\sheight\s*=/.test(prepared)) prepared = prepared.replace('<svg', `<svg width="${W}" height="${H}"`);

    const blob = new Blob([prepared], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cvs = document.createElement('canvas');
        cvs.width = W; cvs.height = H;
        const ctx = cvs.getContext('2d');
        if (fmt === 'image/jpeg') { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
        ctx.drawImage(img, 0, 0, W, H);
        cvs.toBlob((b) => { URL.revokeObjectURL(url); resolve(b); }, fmt, fmt === 'image/png' ? undefined : 0.92);
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  async function rasterizePreview() {
    try {
      const blob = await rasterizeBlob();
      const url = URL.createObjectURL(blob);
      root.querySelector('#svRaster').src = url;
    } catch (e) { console.error(e); }
  }

  svW.addEventListener('input', () => {
    if (lock.checked) svH.value = Math.round(+svW.value * (naturalH / naturalW));
    rasterizePreview();
  });
  svH.addEventListener('input', () => {
    if (lock.checked) svW.value = Math.round(+svH.value * (naturalW / naturalH));
    rasterizePreview();
  });
  root.querySelector('#svFmt').addEventListener('change', rasterizePreview);
  root.querySelector('#svBg').addEventListener('input', rasterizePreview);

  root.querySelector('#svReset').addEventListener('click', () => {
    svgFile = null; svgText = null;
    root.querySelector('#svWorkspace').classList.add('hidden');
  });
  root.querySelector('#svExport').addEventListener('click', async () => {
    if (!svgText) return;
    const blob = await rasterizeBlob();
    const fmt = root.querySelector('#svFmt').value;
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[fmt];
    const base = svgFile.name.replace(/\.svg$/i, '');
    download(blob, `${base}_${svW.value}x${svH.value}.${ext}`);
    analytics.trackToolComplete(toolId);
    analytics.trackToolDownload(toolId);
    toast('Exported', 'success');
  });
}

export const IMAGE_TOOLS = {
  'background-remover': { name: 'Background Remover',   render: renderBackgroundRemover },
  'compressor':         { name: 'Compressor',           render: renderCompressor },
  'resizer':            { name: 'Resizer',              render: renderResizer },
  'converter':          { name: 'Converter',            render: renderConverter },
  'svg-to-image':       { name: 'SVG → Image',          render: renderSvgToImage },
  'social-resizer':     { name: 'Social Media Resizer', render: renderSocialResizer },
  'qr-generator':       { name: 'QR Generator',         render: renderQRGenerator },
};