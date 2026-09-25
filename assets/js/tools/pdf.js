import { analytics } from '../analytics.js';
import { icon, toast, download, fmtBytes, makeDropZone, readAsArrayBuffer, readAsDataURL, readAsText, escapeHTML } from '../utils.js';
import { createPageSwitcher, rasterizePdfPage, rasterizeImageDataURL, rasterizeTextPage } from './pdfPreview.js';

console.log('[pdf.js] module loaded');

const loadPdfLib = () => import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm');
const loadPdfLibEnc = () => import('https://cdn.jsdelivr.net/npm/@cantoo/pdf-lib@2.2.2/+esm');
const loadJsPDF = () => import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm');
const loadJSZip = () => import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');

let _pdfjs = null;
async function loadPdfjs() {
  if (!_pdfjs) {
    _pdfjs = import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';
      return m;
    });
  }
  return _pdfjs;
}

/* ============================================================
   wireColumnDrop — accept drops anywhere in the input column
   ============================================================ */
function wireColumnDrop(column, acceptRegex, onFiles) {
  if (!column) return;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  column.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    stop(e);
    column.classList.add('drag-over');
  });
  column.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    stop(e);
    e.dataTransfer.dropEffect = 'copy';
  });
  column.addEventListener('dragleave', (e) => {
    if (e.target === column || !column.contains(e.relatedTarget)) {
      column.classList.remove('drag-over');
    }
  });
  column.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    stop(e);
    column.classList.remove('drag-over');
    const files = [...e.dataTransfer.files].filter((f) => acceptRegex.test(f.name) || acceptRegex.test(f.type));
    if (files.length) onFiles(files);
    else toast('Unsupported file type', 'error');
  });
}

/* ============================================================
   PDF Creator
   ============================================================ */
function renderPdfCreator(root, toolId) {
  console.log('[Creator] render start');
  let pages = [];
  let switcher = null;
  let uid = 0;

  root.innerHTML = `
    <div class="panel">
      <div class="pdf-tool-layout">
        <div class="pdf-tool-input">
          <div id="pcDrop"></div>
          <div class="format-note" style="margin-top:0">
            <b>Supported:</b> JPG · PNG · WEBP · GIF · TXT · HTML · DOCX — each becomes a page.
          </div>
        </div>
        <div class="pdf-tool-preview">
          <div id="pcWorkspace" class="hidden">
            <div id="pcSwitcher"></div>
            <div class="actions">
              <button type="button" id="pcClear" class="btn btn-outline">Clear all</button>
              <button type="button" id="pcGo" class="btn btn-primary">${icon('file', 16)} Generate PDF</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  console.log('[Creator] HTML injected');

  root.querySelector('#pcDrop').appendChild(makeDropZone({
    accept: 'image/*,text/plain,.txt,.html,.htm,.docx,.pdf',
    multiple: true,
    title: 'Drop files to build a PDF',
    hint: 'Images, text, HTML, DOCX, or PDFs',
    onFiles: (files) => {
      console.log('[Creator] onFiles called with', files.length, 'file(s)');
      files.forEach(addFile);
    },
  }));

  console.log('[Creator] drop zone added');

  wireColumnDrop(
    root.querySelector('.pdf-tool-input'),
    /\.(jpe?g|png|webp|gif|txt|html?|docx|pdf)$/i,
    (files) => {
      console.log('[Creator] column drop with', files.length, 'file(s)');
      files.forEach(addFile);
    }
  );

  async function addFile(file) {
    console.log('[Creator] addFile', file.name, 'type:', file.type, 'size:', file.size);
    const name = file.name.toLowerCase();
    try {
      if (file.type.startsWith('image/')) {
        console.log('[Creator] treating as image');
        const src = await readAsDataURL(file);
        console.log('[Creator] readAsDataURL done, length:', src.length);
        const thumb = await rasterizeImageDataURL(src);
        console.log('[Creator] thumbnail generated:', !!thumb);
        pages.push({ id: 'p' + (++uid), name: file.name, type: 'image', src, thumbnail: thumb });
      } else if (file.type === 'text/plain' || name.endsWith('.txt')) {
        console.log('[Creator] treating as text');
        const text = await readAsText(file);
        pages.push({ id: 'p' + (++uid), name: file.name, type: 'text', text, thumbnail: rasterizeTextPage(text) });
      } else if (file.type === 'text/html' || name.endsWith('.html') || name.endsWith('.htm')) {
        console.log('[Creator] treating as html');
        const html = await readAsText(file);
        const pageId = 'p' + (++uid);
        pages.push({ id: pageId, name: file.name, type: 'html', html, thumbnail: null });
        queueMicrotask(async () => {
          try {
            const thumb = await rasterizeHtml(html);
            const p = pages.find((x) => x.id === pageId);
            if (p && thumb) { p.thumbnail = thumb; refresh(); }
          } catch (e) { console.warn('[Creator] html thumb failed', e); }
        });
      } else if (name.endsWith('.docx')) {
        console.log('[Creator] treating as docx');
        const mammoth = await import('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js');
        const lib = mammoth.default || mammoth;
        const buf = await readAsArrayBuffer(file);
        const result = await lib.convertToHtml({ arrayBuffer: buf });
        const pageId = 'p' + (++uid);
        pages.push({ id: pageId, name: file.name, type: 'html', html: result.value, thumbnail: null });
        queueMicrotask(async () => {
          try {
            const thumb = await rasterizeHtml(result.value);
            const p = pages.find((x) => x.id === pageId);
            if (p && thumb) { p.thumbnail = thumb; refresh(); }
          } catch (e) { console.warn('[Creator] docx thumb failed', e); }
        });
      } else {
        console.warn('[Creator] unsupported file type:', file.type, file.name);
        toast('Unsupported: ' + file.name, 'error');
        return;
      }
      console.log('[Creator] pages array now has', pages.length, 'entries');
      refresh();
    } catch (err) {
      console.error('[Creator] addFile failed:', err);
      toast('Could not read ' + file.name, 'error');
    }
  }

  async function rasterizeHtml(html) {
    const html2canvas = (await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm')).default;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:-99999px;top:0;width:600px;padding:30px;background:#fff;color:#000;font:12px/1.5 -apple-system,sans-serif';
    el.innerHTML = html;
    document.body.appendChild(el);
    try {
      const canvas = await html2canvas(el, { backgroundColor: '#fff', scale: 0.5 });
      return canvas.toDataURL('image/jpeg', 0.7);
    } finally {
      document.body.removeChild(el);
    }
  }

  function refresh() {
    const ws = root.querySelector('#pcWorkspace');
    const layout = root.querySelector('.pdf-tool-layout');
    const wrap = root.querySelector('#pcSwitcher');
    console.log('[Creator] refresh — pages:', pages.length, 'ws?', !!ws, 'layout?', !!layout, 'wrap?', !!wrap);

    if (!pages.length) {
      ws.classList.add('hidden');
      if (layout) layout.classList.remove('has-content');
      return;
    }
    ws.classList.remove('hidden');
    if (layout) layout.classList.add('has-content');

    if (!switcher) {
      console.log('[Creator] creating switcher');
      switcher = createPageSwitcher(wrap, {
        pages: pages.map((p) => ({ id: p.id, label: p.name, thumbnail: p.thumbnail })),
        allowDelete: true,
        onDelete: (id) => { pages = pages.filter((p) => p.id !== id); refresh(); },
        onChange: (next) => {
          const order = next.map((x) => x.id);
          pages.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        },
      });
    } else {
      console.log('[Creator] updating switcher');
      switcher.setPages(pages.map((p) => ({ id: p.id, label: p.name, thumbnail: p.thumbnail })));
    }
  }

  root.querySelector('#pcClear').addEventListener('click', () => {
    if (!pages.length) return;
    if (!confirm('Clear all pages?')) return;
    pages = [];
    switcher = null;
    root.querySelector('#pcSwitcher').innerHTML = '';
    refresh();
  });

  root.querySelector('#pcGo').addEventListener('click', async () => {
    if (!pages.length) return;
    const btn = root.querySelector('#pcGo');
    btn.disabled = true;
    btn.textContent = 'Building…';
    analytics.trackToolStart(toolId);
    try {
      const { jsPDF } = await loadJsPDF();
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      const margin = 32;

      for (let i = 0; i < pages.length; i++) {
        if (i > 0) doc.addPage();
        const p = pages[i];

        if (p.type === 'image') {
          const props = doc.getImageProperties(p.src);
          const availW = pw - margin * 2;
          const availH = ph - margin * 2;
          const r = Math.min(availW / props.width, availH / props.height);
          const w = props.width * r;
          const h = props.height * r;
          doc.addImage(p.src, 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h);
        } else if (p.type === 'text') {
          doc.setFontSize(11);
          const lines = doc.splitTextToSize(p.text, pw - margin * 2);
          let y = margin + 12;
          for (const line of lines) {
            if (y > ph - margin) { doc.addPage(); y = margin + 12; }
            doc.text(line, margin, y);
            y += 15;
          }
        } else if (p.type === 'html') {
          const html2canvas = (await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm')).default;
          const container = document.createElement('div');
          container.style.cssText = 'position:fixed;left:-99999px;top:0;width:794px;padding:40px;background:#fff;color:#000;font:14px/1.5 -apple-system,Segoe UI,sans-serif';
          container.innerHTML = p.html;
          document.body.appendChild(container);
          const canvas = await html2canvas(container, { backgroundColor: '#fff', scale: 1.5 });
          document.body.removeChild(container);
          const src = canvas.toDataURL('image/jpeg', 0.9);
          const props = doc.getImageProperties(src);
          const availW = pw - margin * 2;
          const availH = ph - margin * 2;
          const r = Math.min(availW / props.width, availH / props.height);
          doc.addImage(src, 'JPEG', (pw - props.width * r) / 2, (ph - props.height * r) / 2, props.width * r, props.height * r);
        }
      }
      doc.save('document.pdf');
      analytics.trackToolComplete(toolId);
      analytics.trackToolDownload(toolId);
      toast('PDF saved', 'success');
    } catch (err) {
      console.error(err);
      analytics.trackError(toolId, err);
      toast('Could not build PDF', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = icon('file', 16) + ' Generate PDF';
  });
}

/* ============================================================
   PDF Merge
   ============================================================ */
function renderPdfMerge(root, toolId) {
  let entries = [];
  let files = [];
  let switcher = null;
  let uid = 0;
  const PAGE_THUMB_LIMIT = 300;

  root.innerHTML = `
    <div class="panel">
      <div class="pdf-tool-layout">
        <div class="pdf-tool-input">
          <div id="pmDrop"></div>
          <div class="format-note" style="margin-top:0">
            <b>All pages load individually.</b> Reorder or remove any page before merging.
          </div>
        </div>
        <div class="pdf-tool-preview">
          <div id="pmWorkspace" class="hidden">
            <div id="pmSwitcher"></div>
            <div class="actions">
              <button type="button" id="pmClear" class="btn btn-outline">Clear all</button>
              <button type="button" id="pmGo" class="btn btn-primary">${icon('layers', 16)} Merge selected</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const handleFiles = async (fs) => {
    const btn = root.querySelector('#pmGo');
    if (btn) btn.disabled = true;
    for (const f of fs) await addPdf(f);
    if (btn) btn.disabled = false;
  };

  root.querySelector('#pmDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf',
    multiple: true,
    title: 'Drop PDFs to merge',
    hint: 'Each page becomes an individual entry',
    onFiles: handleFiles,
  }));

  wireColumnDrop(root.querySelector('.pdf-tool-input'), /\.pdf$/i, handleFiles);

  async function addPdf(file) {
    try {
      const buf = await readAsArrayBuffer(file);
      const pdfjsLib = await loadPdfjs();
      const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
      files.push({ file, arrayBuffer: buf, doc });
      const fileIdx = files.length - 1;
      const totalAfter = entries.length + doc.numPages;
      if (totalAfter > PAGE_THUMB_LIMIT) {
        toast(`Skipping thumbnails for ${file.name} — page limit reached`, 'error', 6000);
        return;
      }
      for (let p = 1; p <= doc.numPages; p++) {
        let thumb = null;
        try { thumb = await rasterizePdfPage(doc, p, 0.28); } catch {}
        entries.push({
          id: 'm' + (++uid),
          fileIndex: fileIdx,
          pageIndexInFile: p - 1,
          name: `${file.name} · p.${p}`,
          thumbnail: thumb,
        });
      }
      refresh();
    } catch (err) {
      console.error(err);
      toast('Could not read ' + file.name, 'error');
    }
  }

  function refresh() {
    const ws = root.querySelector('#pmWorkspace');
    const layout = root.querySelector('.pdf-tool-layout');
    const wrap = root.querySelector('#pmSwitcher');

    if (!entries.length) {
      ws.classList.add('hidden');
      if (layout) layout.classList.remove('has-content');
      return;
    }
    ws.classList.remove('hidden');
    if (layout) layout.classList.add('has-content');

    if (!switcher) {
      switcher = createPageSwitcher(wrap, {
        pages: entries.map((e) => ({ id: e.id, label: e.name, thumbnail: e.thumbnail })),
        allowDelete: true,
        onDelete: (id) => { entries = entries.filter((e) => e.id !== id); refresh(); },
        onChange: (next) => {
          const order = next.map((x) => x.id);
          entries.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        },
      });
    } else {
      switcher.setPages(entries.map((e) => ({ id: e.id, label: e.name, thumbnail: e.thumbnail })));
    }
  }

  root.querySelector('#pmClear').addEventListener('click', () => {
    if (!entries.length) return;
    if (!confirm('Clear all pages?')) return;
    entries = [];
    files = [];
    switcher = null;
    root.querySelector('#pmSwitcher').innerHTML = '';
    refresh();
  });

  root.querySelector('#pmGo').addEventListener('click', async () => {
    if (!entries.length) return;
    const btn = root.querySelector('#pmGo');
    btn.disabled = true;
    btn.textContent = 'Merging…';
    analytics.trackToolStart(toolId);
    try {
      const { PDFDocument } = await loadPdfLib();
      const out = await PDFDocument.create();
      const byFile = new Map();
      for (const e of entries) {
        if (!byFile.has(e.fileIndex)) byFile.set(e.fileIndex, []);
        byFile.get(e.fileIndex).push(e.pageIndexInFile);
      }
      const sources = new Map();
      for (const [fileIdx] of byFile) {
        const src = await PDFDocument.load(files[fileIdx].arrayBuffer, { ignoreEncryption: true });
        sources.set(fileIdx, src);
      }
      for (const e of entries) {
        const [copied] = await out.copyPages(sources.get(e.fileIndex), [e.pageIndexInFile]);
        out.addPage(copied);
      }
      const bytes = await out.save();
      download(new Blob([bytes], { type: 'application/pdf' }), 'merged.pdf');
      analytics.trackToolComplete(toolId);
      analytics.trackToolDownload(toolId);
      toast(`Merged ${entries.length} pages`, 'success');
    } catch (err) {
      console.error(err);
      analytics.trackError(toolId, err);
      toast('Merge failed', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = icon('layers', 16) + ' Merge selected';
  });
}

/* ============================================================
   PDF Split
   ============================================================ */
function renderPdfSplit(root, toolId) {
  let pdfFile = null;
  let pdfDoc = null;
  let pages = [];
  let selectedIds = new Set();
  let switcher = null;

  root.innerHTML = `
    <div class="panel">
      <div class="pdf-tool-layout">
        <div class="pdf-tool-input">
          <div id="psDrop"></div>
          <div class="format-note" style="margin-top:0">
            <b>Click thumbnails to select pages.</b> Selected pages are extracted into a new PDF.
            Leave nothing selected to split every page individually.
          </div>
          <div class="field-group" style="margin-top:0;flex-direction:column;align-items:stretch;gap:8px">
            <label class="checkbox-row" style="padding:0"><input type="checkbox" id="psEvery"/> Split every page individually</label>
            <div style="display:flex;gap:8px">
              <button type="button" id="psSelectAll" class="btn btn-outline btn-sm" style="flex:1">Select all</button>
              <button type="button" id="psSelectNone" class="btn btn-outline btn-sm" style="flex:1">Clear</button>
            </div>
          </div>
        </div>
        <div class="pdf-tool-preview">
          <div id="psWorkspace" class="hidden">
            <div id="psSwitcher"></div>
            <div class="actions">
              <button type="button" id="psReset" class="btn btn-outline">Reset</button>
              <button type="button" id="psGo" class="btn btn-primary">${icon('scissors', 16)} Split</button>
            </div>
            <div id="psResults" class="split-results"></div>
          </div>
        </div>
      </div>
    </div>`;

  root.querySelector('#psDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf',
    multiple: false,
    title: 'Drop a PDF to split',
    hint: 'Preview every page and pick which to extract',
    onFiles: ([f]) => load(f),
  }));

  wireColumnDrop(root.querySelector('.pdf-tool-input'), /\.pdf$/i, (files) => files[0] && load(files[0]));

  async function load(file) {
    pdfFile = file;
    const pdfjsLib = await loadPdfjs();
    pdfDoc = await pdfjsLib.getDocument({ data: await readAsArrayBuffer(file) }).promise;

    root.querySelector('#psWorkspace').classList.remove('hidden');
    root.querySelector('.pdf-tool-layout').classList.add('has-content');
    root.querySelector('#psResults').innerHTML = '';
    selectedIds = new Set();

    pages = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      let thumb = null;
      try { thumb = await rasterizePdfPage(pdfDoc, i, 0.28); } catch {}
      pages.push({ id: 'sp' + i, pageNum: i, thumbnail: thumb });
    }

    switcher = null;
    root.querySelector('#psSwitcher').innerHTML = '';
    switcher = createPageSwitcher(root.querySelector('#psSwitcher'), {
      pages: pages.map((p) => ({ id: p.id, label: 'Page ' + p.pageNum, thumbnail: p.thumbnail })),
      selectable: true,
      selectedIds: [],
      onSelectionChange: (ids) => { selectedIds = new Set(ids); },
    });
    analytics.trackToolStart(toolId);
  }

  root.querySelector('#psSelectAll').addEventListener('click', () => {
    selectedIds = new Set(pages.map((p) => p.id));
    switcher.setSelection([...selectedIds]);
  });
  root.querySelector('#psSelectNone').addEventListener('click', () => {
    selectedIds = new Set();
    switcher.setSelection([]);
  });

  root.querySelector('#psReset').addEventListener('click', () => {
    pdfFile = null;
    pdfDoc = null;
    pages = [];
    selectedIds = new Set();
    switcher = null;
    root.querySelector('#psSwitcher').innerHTML = '';
    root.querySelector('#psWorkspace').classList.add('hidden');
    root.querySelector('.pdf-tool-layout').classList.remove('has-content');
    root.querySelector('#psResults').innerHTML = '';
  });

  root.querySelector('#psGo').addEventListener('click', async () => {
    if (!pdfDoc) return;
    const every = root.querySelector('#psEvery').checked;
    const btn = root.querySelector('#psGo');
    btn.disabled = true;
    btn.textContent = 'Splitting…';
    analytics.trackToolStart(toolId);

    try {
      const { PDFDocument } = await loadPdfLib();
      const src = await PDFDocument.load(await readAsArrayBuffer(pdfFile), { ignoreEncryption: true });
      const results = [];

      if (every) {
        for (let i = 0; i < pdfDoc.numPages; i++) {
          const out = await PDFDocument.create();
          const [p] = await out.copyPages(src, [i]);
          out.addPage(p);
          const bytes = await out.save();
          results.push({
            name: `page-${String(i + 1).padStart(3, '0')}.pdf`,
            blob: new Blob([bytes], { type: 'application/pdf' }),
          });
        }
      } else if (selectedIds.size > 0) {
        const indices = pages.filter((p) => selectedIds.has(p.id)).map((p) => p.pageNum - 1);
        const out = await PDFDocument.create();
        const copied = await out.copyPages(src, indices);
        copied.forEach((p) => out.addPage(p));
        const bytes = await out.save();
        results.push({
          name: 'extracted.pdf',
          blob: new Blob([bytes], { type: 'application/pdf' }),
        });
      } else {
        toast('Select pages or enable "Split every page"', 'error');
        btn.disabled = false;
        btn.innerHTML = icon('scissors', 16) + ' Split';
        return;
      }

      renderResults(results);
      analytics.trackToolComplete(toolId);
      toast('Split into ' + results.length + ' file(s)', 'success');
    } catch (err) {
      console.error(err);
      analytics.trackError(toolId, err);
      toast('Split failed', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = icon('scissors', 16) + ' Split';
  });

  function renderResults(results) {
    const box = root.querySelector('#psResults');
    box.innerHTML = results.map((r) => `
      <div class="split-item">
        <span class="split-name">${escapeHTML(r.name)}</span>
        <span class="muted">${fmtBytes(r.blob.size)}</span>
        <button class="btn btn-outline btn-sm" data-name="${escapeHTML(r.name)}">${icon('download', 14)} Download</button>
      </div>`).join('')
      + (results.length > 1
        ? `<div style="margin-top:12px"><button id="psZip" class="btn btn-outline">${icon('archive', 14)} Download all as ZIP</button></div>`
        : '');
    box.querySelectorAll('button[data-name]').forEach((b) => b.addEventListener('click', () => {
      const r = results.find((x) => x.name === b.dataset.name);
      if (r) { download(r.blob, r.name); analytics.trackToolDownload(toolId); }
    }));
    const zbtn = box.querySelector('#psZip');
    if (zbtn) zbtn.addEventListener('click', async () => {
      const { default: JSZip } = await loadJSZip();
      const zip = new JSZip();
      results.forEach((r) => zip.file(r.name, r.blob));
      const blob = await zip.generateAsync({ type: 'blob' });
      download(blob, 'split.zip');
      analytics.trackToolDownload(toolId);
    });
  }
}

/* ============================================================
   PDF Reorder
   ============================================================ */
function renderPdfReorder(root, toolId) {
  let pdfFile = null;
  let order = [];

  root.innerHTML = `
    <div class="panel">
      <div id="proDrop"></div>
      <div id="proWorkspace" class="hidden">
        <p class="muted" style="margin:12px 0">Drag pages to reorder.</p>
        <ul id="proList" class="page-list"></ul>
        <div class="actions">
          <button id="proReverse" class="btn btn-outline">Reverse order</button>
          <button id="proSave" class="btn btn-primary">${icon('download', 16)} Save reordered PDF</button>
        </div>
      </div>
    </div>`;

  root.querySelector('#proDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop a PDF', hint: 'Drag thumbnails to reorder pages',
    onFiles: async ([f]) => {
      pdfFile = f;
      const pdfjsLib = await loadPdfjs();
      const doc = await pdfjsLib.getDocument({ data: await readAsArrayBuffer(f) }).promise;
      const numPages = doc.numPages;
      root.querySelector('#proWorkspace').classList.remove('hidden');
      order = Array.from({ length: numPages }, (_, i) => i);
      const list = root.querySelector('#proList');
      list.innerHTML = '';
      for (let i = 0; i < numPages; i++) {
        const page = await doc.getPage(i + 1);
        const vp = page.getViewport({ scale: 0.4 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const li = document.createElement('li');
        li.className = 'page-item';
        li.draggable = true;
        li.dataset.idx = i;
        li.innerHTML = `<img src="${c.toDataURL()}"/><div class="page-name">Page ${i + 1}</div>`;
        list.appendChild(li);
      }
      enableDrag(list);
      analytics.trackToolStart(toolId);
    },
  }));

  function enableDrag(list) {
    let dragIdx = null;
    list.querySelectorAll('.page-item').forEach((li) => {
      li.addEventListener('dragstart', () => dragIdx = +li.dataset.idx);
      li.addEventListener('dragover', (e) => e.preventDefault());
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        const target = +li.dataset.idx;
        if (dragIdx === null || target === dragIdx) return;
        const [m] = order.splice(dragIdx, 1);
        order.splice(target, 0, m);
        const items = [...list.children];
        const moved = items[dragIdx];
        if (target > dragIdx) list.insertBefore(moved, items[target].nextSibling);
        else list.insertBefore(moved, items[target]);
        [...list.children].forEach((el, i) => el.dataset.idx = i);
        dragIdx = null;
      });
    });
  }

  root.querySelector('#proReverse').addEventListener('click', () => {
    order.reverse();
    const list = root.querySelector('#proList');
    const items = [...list.children].reverse();
    list.innerHTML = '';
    items.forEach((el) => list.appendChild(el));
    [...list.children].forEach((el, i) => el.dataset.idx = i);
  });

  root.querySelector('#proSave').addEventListener('click', async () => {
    if (!pdfFile) return;
    try {
      const { PDFDocument } = await loadPdfLib();
      const src = await PDFDocument.load(await readAsArrayBuffer(pdfFile), { ignoreEncryption: true });
      const out = await PDFDocument.create();
      const pages = await out.copyPages(src, order);
      pages.forEach((p) => out.addPage(p));
      download(new Blob([await out.save()], { type: 'application/pdf' }), pdfFile.name.replace(/\.pdf$/i, '') + '_reordered.pdf');
      analytics.trackToolComplete(toolId);
      analytics.trackToolDownload(toolId);
    } catch (e) { console.error(e); toast('Failed', 'error'); }
  });
}

/* ============================================================
   PDF Rotate
   ============================================================ */
function renderPdfRotate(root, toolId) {
  let pdfFile = null;
  root.innerHTML = `
    <div class="panel">
      <div id="prtDrop"></div>
      <div id="prtWorkspace" class="hidden">
        <div class="field-group">
          <div class="field"><label>Pages</label><input type="text" id="prtPages" placeholder="all, or e.g. 1,3,5-7" value="all"/></div>
          <div class="field"><label>Rotation</label><select id="prtAngle"><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">90° counter-clockwise</option></select></div>
          <button id="prtGo" class="btn btn-primary">${icon('download', 16)} Rotate &amp; Download</button>
        </div>
      </div>
    </div>`;
  root.querySelector('#prtDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop a PDF', hint: 'Rotate all or specific pages',
    onFiles: ([f]) => { pdfFile = f; root.querySelector('#prtWorkspace').classList.remove('hidden'); },
  }));
  root.querySelector('#prtGo').addEventListener('click', async () => {
    if (!pdfFile) return;
    try {
      const { PDFDocument, degrees } = await loadPdfLib();
      const src = await PDFDocument.load(await readAsArrayBuffer(pdfFile), { ignoreEncryption: true });
      const pages = src.getPages();
      const angle = +root.querySelector('#prtAngle').value;
      const pagesStr = root.querySelector('#prtPages').value.trim();
      const targets = pagesStr === 'all' ? pages.map((_, i) => i) : parseRanges(pagesStr, pages.length);
      targets.forEach((i) => {
        const p = pages[i];
        const cur = p.getRotation().angle || 0;
        p.setRotation(degrees((cur + angle) % 360));
      });
      const bytes = await src.save();
      download(new Blob([bytes], { type: 'application/pdf' }), pdfFile.name.replace(/\.pdf$/i, '') + '_rotated.pdf');
      analytics.trackToolComplete(toolId);
      analytics.trackToolDownload(toolId);
      toast('Rotated', 'success');
    } catch (e) { console.error(e); toast('Failed', 'error'); }
  });
}

function parseRanges(str, max) {
  const out = [];
  str.split(',').forEach((part) => {
    part = part.trim();
    if (!part) return;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (m) {
      const a = Math.max(1, +m[1]), b = Math.min(max, +m[2]);
      for (let i = a; i <= b; i++) out.push(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = +part;
      if (n >= 1 && n <= max) out.push(n - 1);
    }
  });
  return [...new Set(out)].sort((a, b) => a - b);
}

/* ============================================================
   PDF Compress
   ============================================================ */
function renderPdfCompress(root, toolId) {
  let pdfFile = null;
  root.innerHTML = `
    <div class="panel">
      <div class="hint-note">Reduces file size by re-rasterizing page content. Best for image-heavy PDFs; text-only PDFs may not shrink much.</div>
      <div id="pcpDrop"></div>
      <div class="field-group">
        <div class="field"><label>Quality <span id="pcpQVal">70%</span></label><input type="range" id="pcpQ" min="30" max="95" value="70"/></div>
        <div class="field"><label>Resolution</label>
          <select id="pcpDpi">
            <option value="1">Screen (72 DPI)</option>
            <option value="1.5" selected>Medium (108 DPI)</option>
            <option value="2">High (144 DPI)</option>
          </select>
        </div>
        <button id="pcpGo" class="btn btn-primary" disabled>${icon('archive', 16)} Compress</button>
      </div>
      <div id="pcpResult" class="hidden" style="margin-top:20px"></div>
    </div>`;
  root.querySelector('#pcpQ').addEventListener('input', (e) => root.querySelector('#pcpQVal').textContent = e.target.value + '%');
  root.querySelector('#pcpDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop a PDF to compress', hint: 'Reduces image quality to shrink file size',
    onFiles: ([f]) => { pdfFile = f; root.querySelector('#pcpGo').disabled = false; },
  }));
  root.querySelector('#pcpGo').addEventListener('click', async () => {
    if (!pdfFile) return;
    const btn = root.querySelector('#pcpGo');
    btn.disabled = true;
    btn.textContent = 'Compressing…';
    analytics.trackToolStart(toolId);
    try {
      const pdfjsLib = await loadPdfjs();
      const pdfjsDoc = await pdfjsLib.getDocument({ data: await readAsArrayBuffer(pdfFile) }).promise;
      const { PDFDocument } = await loadPdfLib();
      const out = await PDFDocument.create();
      const q = +root.querySelector('#pcpQ').value / 100;
      const dpiScale = +root.querySelector('#pcpDpi').value;
      for (let i = 1; i <= pdfjsDoc.numPages; i++) {
        const page = await pdfjsDoc.getPage(i);
        const vp = page.getViewport({ scale: dpiScale });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const img = await out.embedJpg(c.toDataURL('image/jpeg', q));
        const p = out.addPage([vp.width, vp.height]);
        p.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
      }
      const bytes = await out.save();
      const origSize = pdfFile.size;
      const newSize = bytes.byteLength;
      const saved = Math.round((1 - newSize / origSize) * 100);
      root.querySelector('#pcpResult').classList.remove('hidden');
      root.querySelector('#pcpResult').innerHTML = `
        <div class="stat-list">
          <div class="stat-item"><div class="label">Original</div><div class="value">${fmtBytes(origSize)}</div></div>
          <div class="stat-item"><div class="label">Compressed</div><div class="value">${fmtBytes(newSize)}</div></div>
          <div class="stat-item"><div class="label">Saved</div><div class="value" style="color:${saved > 0 ? 'var(--success)' : 'var(--text-3)'}">${saved > 0 ? saved + '%' : '—'}</div></div>
        </div>
        <div class="actions"><button id="pcpDl" class="btn btn-primary">${icon('download', 16)} Download compressed PDF</button></div>`;
      root.querySelector('#pcpDl').addEventListener('click', () => {
        download(new Blob([bytes], { type: 'application/pdf' }), pdfFile.name.replace(/\.pdf$/i, '') + '_compressed.pdf');
        analytics.trackToolDownload(toolId);
      });
      analytics.trackToolComplete(toolId);
      toast('Compressed' + (saved > 0 ? ' — saved ' + saved + '%' : ''), 'success');
    } catch (e) {
      console.error(e); analytics.trackError(toolId, e); toast('Compression failed', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = icon('archive', 16) + ' Compress';
  });
}

/* ============================================================
   PDF → Images
   ============================================================ */
function renderPdfToImages(root, toolId) {
  let pdfFile = null;
  let results = [];
  root.innerHTML = `
    <div class="panel">
      <div id="ptDrop"></div>
      <div class="field-group">
        <div class="field"><label>Format</label><select id="ptFmt"><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option></select></div>
        <div class="field"><label>Quality <span id="ptQVal">92%</span></label><input type="range" id="ptQ" min="10" max="100" value="92"/></div>
        <button id="ptGo" class="btn btn-primary" disabled>${icon('image', 16)} Convert pages</button>
        <button id="ptZip" class="btn btn-outline hidden" disabled>${icon('archive', 16)} ZIP</button>
      </div>
      <div id="ptGrid" class="thumb-grid"></div>
    </div>`;
  root.querySelector('#ptQ').addEventListener('input', (e) => root.querySelector('#ptQVal').textContent = e.target.value + '%');
  root.querySelector('#ptDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop a PDF', hint: 'Each page becomes an image',
    onFiles: ([f]) => { pdfFile = f; root.querySelector('#ptGo').disabled = false; },
  }));
  root.querySelector('#ptGo').addEventListener('click', async () => {
    if (!pdfFile) return;
    const btn = root.querySelector('#ptGo');
    btn.disabled = true;
    btn.textContent = 'Rendering…';
    analytics.trackToolStart(toolId);
    try {
      const pdfjsLib = await loadPdfjs();
      const doc = await pdfjsLib.getDocument({ data: await readAsArrayBuffer(pdfFile) }).promise;
      const fmt = root.querySelector('#ptFmt').value;
      const q = +root.querySelector('#ptQ').value / 100;
      results = [];
      const grid = root.querySelector('#ptGrid');
      grid.innerHTML = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const blob = await new Promise((r) => c.toBlob(r, fmt, fmt === 'image/png' ? undefined : q));
        const ext = fmt === 'image/png' ? 'png' : 'jpg';
        results.push({ name: `page-${String(i).padStart(3, '0')}.${ext}`, blob });
        const url = URL.createObjectURL(blob);
        grid.innerHTML += `<div class="thumb"><img src="${url}"/><div class="done">${i}</div></div>`;
      }
      root.querySelector('#ptZip').classList.remove('hidden');
      root.querySelector('#ptZip').disabled = false;
      analytics.trackToolComplete(toolId);
      toast(doc.numPages + ' pages rendered', 'success');
    } catch (e) {
      console.error(e); analytics.trackError(toolId, e); toast('Conversion failed', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = icon('image', 16) + ' Convert pages';
  });
  root.querySelector('#ptZip').addEventListener('click', async () => {
    const { default: JSZip } = await loadJSZip();
    const zip = new JSZip();
    results.forEach((r) => zip.file(r.name, r.blob));
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, 'pdf-pages.zip');
    analytics.trackToolDownload(toolId);
  });
}

/* ============================================================
   PDF → Word
   ============================================================ */
function renderPdfToWord(root, toolId) {
  let pdfFile = null;
  root.innerHTML = `
    <div class="panel">
      <div class="hint-note"><b>Limited quality:</b> Extracts text only. Does <b>not</b> preserve images, tables, or complex layouts.</div>
      <div id="pwDrop"></div>
      <div class="actions"><button id="pwGo" class="btn btn-primary" disabled>${icon('download', 16)} Extract to .docx</button></div>
    </div>`;
  root.querySelector('#pwDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop a PDF', hint: 'Text content will be extracted',
    onFiles: ([f]) => { pdfFile = f; root.querySelector('#pwGo').disabled = false; },
  }));
  root.querySelector('#pwGo').addEventListener('click', async () => {
    if (!pdfFile) return;
    const btn = root.querySelector('#pwGo');
    btn.disabled = true;
    btn.textContent = 'Extracting…';
    analytics.trackToolStart(toolId);
    try {
      const pdfjsLib = await loadPdfjs();
      const doc = await pdfjsLib.getDocument({ data: await readAsArrayBuffer(pdfFile) }).promise;
      let fullText = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map((it) => it.str).join('') + '\n\n';
      }
      const { Document, Packer, Paragraph, TextRun } = await import('https://cdn.jsdelivr.net/npm/docx@8.5.0/+esm');
      const paragraphs = fullText.split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] }));
      const docxDoc = new Document({ sections: [{ children: paragraphs }] });
      const blob = await Packer.toBlob(docxDoc);
      download(blob, pdfFile.name.replace(/\.pdf$/i, '') + '.docx');
      analytics.trackToolComplete(toolId);
      analytics.trackToolDownload(toolId);
      toast('Extracted to .docx', 'success');
    } catch (e) {
      console.error(e); analytics.trackError(toolId, e); toast('Failed', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = icon('download', 16) + ' Extract to .docx';
  });
}

/* ============================================================
   PDF Compare
   ============================================================ */
function renderPdfCompare(root, toolId) {
  let pdfA = null, pdfB = null;
  root.innerHTML = `
    <div class="panel">
      <div class="dual-drop">
        <div><label class="drop-label">PDF A</label><div id="pcA"></div></div>
        <div><label class="drop-label">PDF B</label><div id="pcB"></div></div>
      </div>
      <div class="actions"><button id="pcGo" class="btn btn-primary" disabled>${icon('eye', 16)} Compare</button></div>
      <div id="pcResults" class="compare-results hidden"></div>
    </div>`;
  root.querySelector('#pcA').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop PDF A', hint: 'Reference document',
    onFiles: ([f]) => { pdfA = f; updateBtn(); },
  }));
  root.querySelector('#pcB').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop PDF B', hint: 'Document to compare',
    onFiles: ([f]) => { pdfB = f; updateBtn(); },
  }));
  function updateBtn() { root.querySelector('#pcGo').disabled = !(pdfA && pdfB); }
  root.querySelector('#pcGo').addEventListener('click', async () => {
    if (!pdfA || !pdfB) return;
    const btn = root.querySelector('#pcGo');
    btn.disabled = true;
    btn.textContent = 'Comparing…';
    analytics.trackToolStart(toolId);
    try {
      const pdfjsLib = await loadPdfjs();
      const [bufA, bufB] = await Promise.all([readAsArrayBuffer(pdfA), readAsArrayBuffer(pdfB)]);
      const [docA, docB] = await Promise.all([
        pdfjsLib.getDocument({ data: bufA }).promise,
        pdfjsLib.getDocument({ data: bufB }).promise,
      ]);
      const maxPages = Math.max(docA.numPages, docB.numPages);
      const box = root.querySelector('#pcResults');
      box.classList.remove('hidden');
      box.innerHTML = `<p class="muted" style="margin-bottom:16px">A: ${docA.numPages} pages · B: ${docB.numPages} pages</p><div id="pcGrid" class="compare-grid"></div>`;
      const grid = box.querySelector('#pcGrid');
      for (let i = 1; i <= maxPages; i++) {
        const pageA = i <= docA.numPages ? await docA.getPage(i) : null;
        const pageB = i <= docB.numPages ? await docB.getPage(i) : null;
        const viewport = (pageA || pageB).getViewport({ scale: 0.6 });
        const cA = pageA ? await renderPageToCanvas(pageA, viewport) : null;
        const cB = pageB ? await renderPageToCanvas(pageB, viewport) : null;
        const diffPct = (cA && cB) ? pixelDiffPercent(cA, cB) : (cA || cB ? 100 : 0);
        const wrap = document.createElement('div');
        wrap.className = 'compare-row';
        wrap.innerHTML = `
          <div class="compare-row-header">
            <span>Page ${i}</span>
            <span class="diff-badge ${diffPct > 5 ? 'diff-high' : diffPct > 0.5 ? 'diff-mid' : 'diff-low'}">${diffPct.toFixed(1)}% different</span>
          </div>
          <div class="compare-row-body">
            <div class="cmp-col"><div class="cmp-label">A</div>${cA ? `<img src="${cA.toDataURL()}"/>` : '<div class="missing">—</div>'}</div>
            <div class="cmp-col"><div class="cmp-label">B</div>${cB ? `<img src="${cB.toDataURL()}"/>` : '<div class="missing">—</div>'}</div>
          </div>`;
        grid.appendChild(wrap);
      }
      analytics.trackToolComplete(toolId);
      toast('Comparison ready', 'success');
    } catch (err) {
      console.error(err); analytics.trackError(toolId, err); toast('Compare failed', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = icon('eye', 16) + ' Compare';
  });
}

async function renderPageToCanvas(page, viewport) {
  const c = document.createElement('canvas');
  c.width = viewport.width; c.height = viewport.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
  return c;
}

function pixelDiffPercent(cA, cB) {
  if (cA.width !== cB.width || cA.height !== cB.height) {
    const tmp = document.createElement('canvas');
    tmp.width = cA.width; tmp.height = cA.height;
    tmp.getContext('2d').drawImage(cB, 0, 0, cA.width, cA.height);
    cB = tmp;
  }
  const a = cA.getContext('2d').getImageData(0, 0, cA.width, cA.height).data;
  const b = cB.getContext('2d').getImageData(0, 0, cB.width, cB.height).data;
  let diff = 0;
  const total = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > 30) diff++;
  }
  return (diff / total) * 100;
}

/* ============================================================
   PDF Redact
   ============================================================ */
function renderPdfRedact(root, toolId) {
  let pdfFile = null, pdfjsDoc = null, currentPage = 1;
  let redactionsByPage = {};
  root.innerHTML = `
    <div class="panel">
      <div id="prDrop"></div>
      <div id="prWorkspace" class="hidden">
        <div class="format-note"><b>Note:</b> Rasterizes pages — redacted content is permanently removed.</div>
        <div class="redact-toolbar">
          <button id="prPrev" class="btn btn-outline btn-sm">←</button>
          <span id="prPageLabel" class="muted">Page 1 / 1</span>
          <button id="prNext" class="btn btn-outline btn-sm">→</button>
          <button id="prClearBoxes" class="btn btn-outline btn-sm">Clear boxes</button>
          <button id="prGo" class="btn btn-primary btn-sm">${icon('download', 14)} Export redacted PDF</button>
        </div>
        <div class="redact-canvas-wrap"><div id="prCanvasStack" class="redact-canvas-stack"></div></div>
        <p class="crop-hint">Click and drag over the page to draw a redaction box.</p>
      </div>
    </div>`;
  root.querySelector('#prDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop a PDF to redact', hint: 'Draw boxes over sensitive information',
    onFiles: ([f]) => load(f),
  }));
  async function load(file) {
    pdfFile = file;
    const pdfjsLib = await loadPdfjs();
    pdfjsDoc = await pdfjsLib.getDocument({ data: await readAsArrayBuffer(file) }).promise;
    root.querySelector('#prWorkspace').classList.remove('hidden');
    redactionsByPage = {};
    await renderPage(1);
  }
  async function renderPage(n) {
    currentPage = n;
    root.querySelector('#prPageLabel').textContent = 'Page ' + n + ' / ' + pdfjsDoc.numPages;
    const page = await pdfjsDoc.getPage(n);
    const vp = page.getViewport({ scale: 1.4 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const stack = root.querySelector('#prCanvasStack');
    stack.innerHTML = '';
    stack.appendChild(c);
    const overlay = document.createElement('div');
    overlay.className = 'redact-overlay';
    overlay.style.width = c.width + 'px';
    overlay.style.height = c.height + 'px';
    stack.appendChild(overlay);
    (redactionsByPage[n] || []).forEach((r) => overlay.appendChild(boxEl(r, overlay, n)));
    let start = null, live = null;
    overlay.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const rect = overlay.getBoundingClientRect();
      start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      live = document.createElement('div');
      live.className = 'redact-box live';
      overlay.appendChild(live);
    });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    function onMove(e) {
      if (!start || !live) return;
      const rect = overlay.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const left = Math.min(x, start.x), top = Math.min(y, start.y);
      const w = Math.abs(x - start.x), h = Math.abs(y - start.y);
      Object.assign(live.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!live || !start) return;
      const rect = live.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      const box = { x: rect.left - overlayRect.left, y: rect.top - overlayRect.top, w: rect.width, h: rect.height };
      live.remove();
      if (box.w < 4 || box.h < 4) { start = null; live = null; return; }
      redactionsByPage[n] = redactionsByPage[n] || [];
      redactionsByPage[n].push(box);
      overlay.appendChild(boxEl(box, overlay, n));
      start = null; live = null;
    }
  }
  function boxEl(box, overlay, pageNum) {
    const el = document.createElement('div');
    el.className = 'redact-box';
    Object.assign(el.style, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' });
    el.addEventListener('dblclick', () => {
      el.remove();
      const arr = redactionsByPage[pageNum] || [];
      const idx = arr.indexOf(box);
      if (idx >= 0) arr.splice(idx, 1);
    });
    return el;
  }
  root.querySelector('#prPrev').addEventListener('click', () => { if (currentPage > 1) renderPage(currentPage - 1); });
  root.querySelector('#prNext').addEventListener('click', () => { if (currentPage < pdfjsDoc.numPages) renderPage(currentPage + 1); });
  root.querySelector('#prClearBoxes').addEventListener('click', () => { redactionsByPage[currentPage] = []; renderPage(currentPage); });
  root.querySelector('#prGo').addEventListener('click', async () => {
    if (!pdfjsDoc) return;
    const btn = root.querySelector('#prGo');
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    analytics.trackToolStart(toolId);
    try {
      const { PDFDocument } = await loadPdfLib();
      const out = await PDFDocument.create();
      for (let i = 1; i <= pdfjsDoc.numPages; i++) {
        const page = await pdfjsDoc.getPage(i);
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const pageRenders = page.getViewport({ scale: 1.4 });
        const sx = vp.width / pageRenders.width;
        const sy = vp.height / pageRenders.height;
        const boxes = redactionsByPage[i] || [];
        const ctx = c.getContext('2d');
        boxes.forEach((b) => {
          ctx.fillStyle = '#000';
          ctx.fillRect(b.x * sx, b.y * sy, b.w * sx, b.h * sy);
        });
        const dataUrl = c.toDataURL('image/jpeg', 0.92);
        const img = await out.embedJpg(dataUrl);
        const p = out.addPage([vp.width, vp.height]);
        p.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
      }
      const bytes = await out.save();
      download(new Blob([bytes], { type: 'application/pdf' }), 'redacted.pdf');
      analytics.trackToolComplete(toolId);
      analytics.trackToolDownload(toolId);
      toast('Redacted PDF exported', 'success');
    } catch (err) {
      console.error(err); analytics.trackError(toolId, err); toast('Export failed', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = icon('download', 14) + ' Export redacted PDF';
  });
}

/* ============================================================
   PDF Password
   ============================================================ */
function renderPdfPassword(root, toolId) {
  let pdfFile = null;
  root.innerHTML = `
    <div class="panel">
      <div id="ppDrop"></div>
      <div class="format-note">Uses AES encryption. Some very old PDF viewers may not open the result.</div>
      <div class="field-group">
        <div class="field"><label>User password</label><input type="password" id="ppUser" autocomplete="new-password"/></div>
        <div class="field"><label>Owner password (optional)</label><input type="password" id="ppOwner" autocomplete="new-password"/></div>
      </div>
      <div class="field-group">
        <label class="checkbox-row"><input type="checkbox" id="ppAllowPrint" checked/> Allow printing</label>
        <label class="checkbox-row"><input type="checkbox" id="ppAllowCopy"/> Allow copying text</label>
      </div>
      <div class="actions"><button id="ppGo" class="btn btn-primary" disabled>${icon('lock', 16)} Encrypt PDF</button></div>
    </div>`;
  root.querySelector('#ppDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop a PDF to protect', hint: 'Add a password before sharing',
    onFiles: ([f]) => { pdfFile = f; root.querySelector('#ppGo').disabled = false; },
  }));
  root.querySelector('#ppGo').addEventListener('click', async () => {
    if (!pdfFile) return;
    const userPwd = root.querySelector('#ppUser').value;
    if (!userPwd) return toast('Enter a user password', 'error');
    const ownerPwd = root.querySelector('#ppOwner').value || userPwd;
    const btn = root.querySelector('#ppGo');
    btn.disabled = true;
    btn.textContent = 'Encrypting…';
    analytics.trackToolStart(toolId);
    try {
      const mod = await loadPdfLibEnc();
      const PDFDocument = mod.PDFDocument || (mod.default && mod.default.PDFDocument);
      const buf = await readAsArrayBuffer(pdfFile);
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
      const bytes = await pdf.save({
        userPassword: userPwd,
        ownerPassword: ownerPwd,
        permissions: {
          printing: root.querySelector('#ppAllowPrint').checked ? 'highResolution' : undefined,
          copying: root.querySelector('#ppAllowCopy').checked,
        },
      });
      download(new Blob([bytes], { type: 'application/pdf' }), pdfFile.name.replace(/\.pdf$/i, '') + '_protected.pdf');
      analytics.trackToolComplete(toolId);
      analytics.trackToolDownload(toolId);
      toast('Encrypted PDF saved', 'success');
    } catch (err) {
      console.error(err); analytics.trackError(toolId, err);
      toast('Encryption failed', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = icon('lock', 16) + ' Encrypt PDF';
  });
}

/* ============================================================
   PDF Unlock
   ============================================================ */
function renderPdfUnlock(root, toolId) {
  let pdfFile = null;
  root.innerHTML = `
    <div class="panel">
      <div class="hint-note">Removes password protection from a PDF. You must know the current password.</div>
      <div id="puDrop"></div>
      <div class="field-group">
        <div class="field"><label>Current password</label><input type="password" id="puPwd" autocomplete="current-password"/></div>
        <button id="puGo" class="btn btn-primary" disabled>${icon('lock', 16)} Remove password</button>
      </div>
    </div>`;
  root.querySelector('#puDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop a protected PDF', hint: 'Enter its password to unlock',
    onFiles: ([f]) => { pdfFile = f; root.querySelector('#puGo').disabled = false; },
  }));
  root.querySelector('#puGo').addEventListener('click', async () => {
    if (!pdfFile) return;
    const pwd = root.querySelector('#puPwd').value;
    try {
      const { PDFDocument } = await loadPdfLib();
      const src = await PDFDocument.load(await readAsArrayBuffer(pdfFile), { password: pwd, ignoreEncryption: true });
      const bytes = await src.save();
      download(new Blob([bytes], { type: 'application/pdf' }), pdfFile.name.replace(/\.pdf$/i, '') + '_unlocked.pdf');
      analytics.trackToolComplete(toolId);
      analytics.trackToolDownload(toolId);
      toast('Password removed', 'success');
    } catch (e) { console.error(e); toast('Wrong password or unsupported encryption', 'error'); }
  });
}

/* ============================================================
   PDF Sign
   ============================================================ */
function renderPdfSign(root, toolId) {
  let pdfFile = null, pdfjsDoc = null, sigDataURL = null, currentPage = 1;
  let sigByPage = {};
  root.innerHTML = `
    <div class="panel">
      <div id="psgDrop"></div>
      <div id="psgWorkspace" class="hidden">
        <div class="sig-source">
          <p class="muted">Draw your signature below, or upload a transparent PNG.</p>
          <canvas id="sigPad" width="600" height="180"></canvas>
          <div class="sig-actions">
            <button id="sigClear" class="btn btn-outline btn-sm">Clear</button>
            <label class="btn btn-outline btn-sm" style="cursor:pointer">
              ${icon('upload', 14)} Upload PNG
              <input type="file" id="sigUpload" accept="image/png,image/*" class="hidden"/>
            </label>
          </div>
        </div>
        <div class="redact-toolbar">
          <button id="psgPrev" class="btn btn-outline btn-sm">←</button>
          <span id="psgPageLabel" class="muted">Page 1 / 1</span>
          <button id="psgNext" class="btn btn-outline btn-sm">→</button>
          <button id="psgPlace" class="btn btn-outline btn-sm">Place signature on this page</button>
          <button id="psgGo" class="btn btn-primary btn-sm">${icon('download', 14)} Export signed PDF</button>
        </div>
        <div class="redact-canvas-wrap"><div id="psgCanvasStack" class="redact-canvas-stack"></div></div>
      </div>
    </div>`;
  root.querySelector('#psgDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop a PDF to sign', hint: 'Draw a signature and place it on any page',
    onFiles: ([f]) => load(f),
  }));
  const pad = root.querySelector('#sigPad');
  const padCtx = pad.getContext('2d');
  let drawing = false;
  const pos = (e) => {
    const r = pad.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (pad.width / r.width), y: (t.clientY - r.top) * (pad.height / r.height) };
  };
  const start = (e) => { e.preventDefault(); drawing = true; const p = pos(e); padCtx.beginPath(); padCtx.moveTo(p.x, p.y); };
  const move = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    padCtx.lineWidth = 3;
    padCtx.lineCap = 'round';
    padCtx.strokeStyle = '#0f172a';
    padCtx.lineTo(p.x, p.y);
    padCtx.stroke();
  };
  const end = () => { drawing = false; sigDataURL = pad.toDataURL('image/png'); };
  pad.addEventListener('mousedown', start);
  pad.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  pad.addEventListener('touchstart', start, { passive: false });
  pad.addEventListener('touchmove', move, { passive: false });
  pad.addEventListener('touchend', end);
  padCtx.fillStyle = '#fff';
  padCtx.fillRect(0, 0, pad.width, pad.height);
  root.querySelector('#sigClear').addEventListener('click', () => {
    padCtx.fillStyle = '#fff';
    padCtx.fillRect(0, 0, pad.width, pad.height);
    sigDataURL = null;
  });
  root.querySelector('#sigUpload').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    sigDataURL = await readAsDataURL(f);
    toast('Signature uploaded');
  });
  async function load(file) {
    pdfFile = file;
    const pdfjsLib = await loadPdfjs();
    pdfjsDoc = await pdfjsLib.getDocument({ data: await readAsArrayBuffer(file) }).promise;
    root.querySelector('#psgWorkspace').classList.remove('hidden');
    sigByPage = {};
    await renderPage(1);
  }
  async function renderPage(n) {
    currentPage = n;
    root.querySelector('#psgPageLabel').textContent = 'Page ' + n + ' / ' + pdfjsDoc.numPages;
    const page = await pdfjsDoc.getPage(n);
    const vp = page.getViewport({ scale: 1.4 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const stack = root.querySelector('#psgCanvasStack');
    stack.innerHTML = '';
    stack.appendChild(c);
    const sig = sigByPage[n];
    if (sig && sigDataURL) {
      const img = document.createElement('img');
      img.src = sigDataURL;
      img.className = 'sig-overlay';
      Object.assign(img.style, { left: sig.x + 'px', top: sig.y + 'px', width: sig.w + 'px', height: 'auto', position: 'absolute' });
      const overlay = document.createElement('div');
      overlay.className = 'redact-overlay';
      overlay.style.width = c.width + 'px';
      overlay.style.height = c.height + 'px';
      overlay.appendChild(img);
      stack.appendChild(overlay);
      let sx = 0, sy = 0, origX = 0, origY = 0;
      img.addEventListener('mousedown', (e) => {
        e.preventDefault();
        sx = e.clientX; sy = e.clientY; origX = sig.x; origY = sig.y;
        const onMove = (ev) => {
          sig.x = origX + (ev.clientX - sx);
          sig.y = origY + (ev.clientY - sy);
          img.style.left = sig.x + 'px';
          img.style.top = sig.y + 'px';
        };
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }
  }
  root.querySelector('#psgPlace').addEventListener('click', () => {
    if (!sigDataURL) return toast('Draw or upload a signature first', 'error');
    sigByPage[currentPage] = { x: 40, y: 40, w: 200 };
    renderPage(currentPage);
  });
  root.querySelector('#psgPrev').addEventListener('click', () => { if (currentPage > 1) renderPage(currentPage - 1); });
  root.querySelector('#psgNext').addEventListener('click', () => { if (currentPage < pdfjsDoc.numPages) renderPage(currentPage + 1); });
  root.querySelector('#psgGo').addEventListener('click', async () => {
    if (!pdfjsDoc) return;
    const btn = root.querySelector('#psgGo');
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    analytics.trackToolStart(toolId);
    try {
      const { PDFDocument } = await loadPdfLib();
      const buf = await readAsArrayBuffer(pdfFile);
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = pdf.getPages();
      for (let i = 1; i <= pdfjsDoc.numPages; i++) {
        const sig = sigByPage[i];
        if (!sig || !sigDataURL) continue;
        const pdfjsPage = await pdfjsDoc.getPage(i);
        const vpLow = pdfjsPage.getViewport({ scale: 1.4 });
        const targetPage = pages[i - 1];
        const target = targetPage.getSize();
        const sx = target.width / vpLow.width;
        const sy = target.height / vpLow.height;
        const sigBlob = await (await fetch(sigDataURL)).blob();
        const sigImg = await pdf.embedPng(await sigBlob.arrayBuffer());
        const sigW = sig.w * sx;
        const sigH = (sigImg.height / sigImg.width) * sigW;
        targetPage.drawImage(sigImg, {
          x: sig.x * sx,
          y: target.height - (sig.y * sy) - sigH,
          width: sigW,
          height: sigH,
        });
      }
      const bytes = await pdf.save();
      download(new Blob([bytes], { type: 'application/pdf' }), pdfFile.name.replace(/\.pdf$/i, '') + '_signed.pdf');
      analytics.trackToolComplete(toolId);
      analytics.trackToolDownload(toolId);
      toast('Signed PDF saved', 'success');
    } catch (err) {
      console.error(err); analytics.trackError(toolId, err); toast('Signing failed', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = icon('download', 14) + ' Export signed PDF';
  });
}

export const PDF_TOOLS = {
  'creator':       { name: 'Creator',          render: renderPdfCreator },
  'merge':         { name: 'Merge',            render: renderPdfMerge },
  'split':         { name: 'Split',            render: renderPdfSplit },
  'reorder':       { name: 'Reorder Pages',    render: renderPdfReorder },
  'rotate':        { name: 'Rotate Pages',     render: renderPdfRotate },
  'compress':      { name: 'Compress',         render: renderPdfCompress },
  'pdf-to-image':  { name: 'PDF → Image',      render: renderPdfToImages },
  'pdf-to-word':   { name: 'PDF → Word',       render: renderPdfToWord },
  'compare':       { name: 'Compare',          render: renderPdfCompare },
  'redact':        { name: 'Redact',           render: renderPdfRedact },
  'password':      { name: 'Password Protect', render: renderPdfPassword },
  'unlock':        { name: 'Unlock',           render: renderPdfUnlock },
  'sign':          { name: 'Sign',             render: renderPdfSign },
};