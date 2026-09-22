import { analytics } from '../analytics.js';
import { $, $$, icon, toast, download, loadImage, fmtBytes, makeDropZone, readAsArrayBuffer, readAsDataURL, readAsText, escapeHTML } from '../utils.js';
import { createPageSwitcher, rasterizePdfPage, rasterizeImageDataURL, rasterizeTextPage } from './pdfPreview.js';

const loadPdfLib = () => import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm');
// @cantoo/pdf-lib is a fork with real encryption (userPassword/ownerPassword)
const loadPdfLibEnc = () => import('https://cdn.jsdelivr.net/npm/@cantoo/pdf-lib@2.2.2/+esm');
const loadJsPDF = () => import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm');
const loadJSZip = () => import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');

// pdfjs (for compare)
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
   PDF Creator — expanded input support
   ============================================================ */
function renderPdfCreator(root, toolId) {
  let pages = [];   // { id, name, type, src|text|html, thumbnail }
  let switcher = null;
  let uid = 0;

  root.innerHTML = `
    <div class="panel">
      <div id="pcDrop"></div>
      <div class="format-note">
        <b>Supported:</b> JPG · PNG · WEBP · GIF · TXT · HTML · DOCX — each becomes a page in the PDF.
      </div>
      <div id="pcWorkspace" class="hidden">
        <div id="pcSwitcher"></div>
        <div class="actions">
          <button type="button" id="pcClear" class="btn btn-outline">Clear all</button>
          <button type="button" id="pcGo" class="btn btn-primary">${icon('file', 16)} Generate PDF</button>
        </div>
      </div>
    </div>`;

  root.querySelector('#pcDrop').appendChild(makeDropZone({
    accept: 'image/*,text/plain,.txt,.html,.htm,.docx,.pdf',
    multiple: true,
    title: 'Drop files to build a PDF',
    hint: 'Images, text, HTML, DOCX, or PDFs',
    onFiles: (files) => files.forEach(addFile),
  }));

  async function addFile(file) {
    const name = file.name.toLowerCase();
    try {
      if (file.type.startsWith('image/')) {
        const src = await readAsDataURL(file);
        const thumb = await rasterizeImageDataURL(src);
        pages.push({ id: 'p' + (++uid), name: file.name, type: 'image', src, thumbnail: thumb });
      } else if (file.type === 'text/plain' || name.endsWith('.txt')) {
        const text = await readAsText(file);
        pages.push({ id: 'p' + (++uid), name: file.name, type: 'text', text, thumbnail: rasterizeTextPage(text) });
      } else if (file.type === 'text/html' || name.endsWith('.html') || name.endsWith('.htm')) {
        const html = await readAsText(file);
        pages.push({ id: 'p' + (++uid), name: file.name, type: 'html', html, thumbnail: null });
        // Rasterize html thumbnail after the fact (so we don't block on import)
        queueMicrotask(async () => {
          try {
            const thumb = await rasterizeHtml(html);
            const p = pages.find((x) => x.name === file.name && x.type === 'html' && !x.thumbnail);
            if (p && thumb) { p.thumbnail = thumb; refresh(); }
          } catch {}
        });
      } else if (name.endsWith('.docx')) {
        const mammoth = await import('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js');
        const lib = mammoth.default || mammoth;
        const buf = await readAsArrayBuffer(file);
        const result = await lib.convertToHtml({ arrayBuffer: buf });
        pages.push({ id: 'p' + (++uid), name: file.name, type: 'html', html: result.value, thumbnail: null });
        queueMicrotask(async () => {
          try {
            const thumb = await rasterizeHtml(result.value);
            const p = pages.find((x) => x.name === file.name && x.type === 'html' && !x.thumbnail);
            if (p && thumb) { p.thumbnail = thumb; refresh(); }
          } catch {}
        });
      } else {
        toast('Unsupported: ' + file.name, 'error');
        return;
      }
      refresh();
    } catch (err) {
      console.error(err);
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
    const wrap = root.querySelector('#pcSwitcher');
    if (!pages.length) {
      ws.classList.add('hidden');
      return;
    }
    ws.classList.remove('hidden');
    if (!switcher) {
      switcher = createPageSwitcher(wrap, {
        pages: pages.map((p) => ({ id: p.id, label: p.name, thumbnail: p.thumbnail })),
        allowDelete: true,
        onDelete: (id) => { pages = pages.filter((p) => p.id !== id); refresh(); },
        onChange: (next) => {
          // Reorder `pages` to match the switcher's order
          const order = next.map((x) => x.id);
          pages.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        },
      });
    } else {
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
      const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm');
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
  // Each entry: { id, fileIndex, pageIndexInFile, thumbnail }
  let entries = [];
  let files = [];       // { file, arrayBuffer, doc }
  let switcher = null;
  let uid = 0;

  const PAGE_THUMB_LIMIT = 300;

  root.innerHTML = `
    <div class="panel">
      <div id="pmDrop"></div>
      <div class="format-note">
        <b>All pages are loaded individually.</b> Reorder or remove any page before merging.
      </div>
      <div id="pmWorkspace" class="hidden">
        <div id="pmSwitcher"></div>
        <div class="actions">
          <button type="button" id="pmClear" class="btn btn-outline">Clear all</button>
          <button type="button" id="pmGo" class="btn btn-primary">${icon('layers', 16)} Merge selected</button>
        </div>
      </div>
    </div>`;

  root.querySelector('#pmDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf',
    multiple: true,
    title: 'Drop PDFs to merge',
    hint: 'Each page becomes an individual entry below',
    onFiles: async (fs) => {
      const btn = root.querySelector('#pmGo');
      if (btn) btn.disabled = true;
      for (const f of fs) await addPdf(f);
      if (btn) btn.disabled = false;
    },
  }));

  async function addPdf(file) {
    try {
      const buf = await readAsArrayBuffer(file);
      const pdfjsLib = await loadPdfjs();
      const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
      files.push({ file, arrayBuffer: buf, doc });

      const fileIdx = files.length - 1;
      const totalAfter = entries.length + doc.numPages;
      if (totalAfter > PAGE_THUMB_LIMIT) {
        toast(`Skipping thumbnails for ${file.name} — page limit reached (${PAGE_THUMB_LIMIT})`, 'error', 6000);
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
    const wrap = root.querySelector('#pmSwitcher');
    if (!entries.length) {
      ws.classList.add('hidden');
      return;
    }
    ws.classList.remove('hidden');
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

      // Group by source file to reduce PDFDocument.load calls
      const byFile = new Map();
      for (const e of entries) {
        if (!byFile.has(e.fileIndex)) byFile.set(e.fileIndex, []);
        byFile.get(e.fileIndex).push(e.pageIndexInFile);
      }

      // Load each source once
      const sources = new Map();
      for (const [fileIdx] of byFile) {
        const src = await PDFDocument.load(files[fileIdx].arrayBuffer, { ignoreEncryption: true });
        sources.set(fileIdx, src);
      }

      // Copy pages in the user-specified order
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
  let pages = [];         // { id, pageNum, thumbnail }
  let selectedIds = new Set();
  let switcher = null;

  root.innerHTML = `
    <div class="panel">
      <div id="psDrop"></div>
      <div id="psWorkspace" class="hidden">
        <div class="format-note">
          <b>Click thumbnails to select pages.</b> The selected pages will be extracted into a new PDF.
          Leave nothing selected to split every page into separate files.
        </div>
        <div id="psSwitcher"></div>
        <div class="field-group" style="margin-top:16px">
          <label class="checkbox-row"><input type="checkbox" id="psEvery"/> Split every page individually</label>
          <button type="button" id="psSelectAll" class="btn btn-outline btn-sm">Select all</button>
          <button type="button" id="psSelectNone" class="btn btn-outline btn-sm">Clear selection</button>
        </div>
        <div class="actions">
          <button type="button" id="psReset" class="btn btn-outline">Reset</button>
          <button type="button" id="psGo" class="btn btn-primary">${icon('scissors', 16)} Split</button>
        </div>
        <div id="psResults" class="split-results"></div>
      </div>
    </div>`;

  root.querySelector('#psDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf',
    multiple: false,
    title: 'Drop a PDF to split',
    hint: 'Preview every page and pick which to extract',
    onFiles: ([f]) => load(f),
  }));

  async function load(file) {
    pdfFile = file;
    const pdfjsLib = await loadPdfjs();
    pdfDoc = await pdfjsLib.getDocument({ data: await readAsArrayBuffer(file) }).promise;
    root.querySelector('#psWorkspace').classList.remove('hidden');
    root.querySelector('#psResults').innerHTML = '';
    selectedIds = new Set();

    pages = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      let thumb = null;
      try { thumb = await rasterizePdfPage(pdfDoc, i, 0.28); } catch {}
      pages.push({ id: 'sp' + i, pageNum: i, thumbnail: thumb });
    }

    if (switcher) switcher = null;
    root.querySelector('#psSwitcher').innerHTML = '';
    switcher = createPageSwitcher(root.querySelector('#psSwitcher'), {
      pages: pages.map((p) => ({ id: p.id, label: 'Page ' + p.pageNum, thumbnail: p.thumbnail })),
      selectable: true,
      selectedIds: [],
      onSelectionChange: (ids) => {
        selectedIds = new Set(ids);
      },
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
        const indices = pages
          .filter((p) => selectedIds.has(p.id))
          .map((p) => p.pageNum - 1);
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
      if (r) {
        download(r.blob, r.name);
        analytics.trackToolDownload(toolId);
      }
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
   PDF Compare
   ============================================================ */
function renderPdfCompare(root, toolId) {
  let pdfA = null, pdfB = null;
  root.innerHTML = `
    <div class="panel">
      <div class="dual-drop">
        <div>
          <label class="drop-label">PDF A</label>
          <div id="pcA"></div>
        </div>
        <div>
          <label class="drop-label">PDF B</label>
          <div id="pcB"></div>
        </div>
      </div>
      <div class="actions">
        <button id="pcGo" class="btn btn-primary" disabled>${icon('eye', 16)} Compare</button>
      </div>
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
    btn.disabled = true; btn.textContent = 'Comparing…';
    analytics.trackToolStart(toolId);
    try {
      const pdfjsLib = await loadPdfjs();
      const [bufA, bufB] = await Promise.all([readAsArrayBuffer(pdfA), readAsArrayBuffer(pdfB)]);
      const [docA, docB] = await Promise.all([pdfjsLib.getDocument({ data: bufA }).promise, pdfjsLib.getDocument({ data: bufB }).promise]);
      const maxPages = Math.max(docA.numPages, docB.numPages);
      const box = root.querySelector('#pcResults');
      box.classList.remove('hidden');
      box.innerHTML = `<p class="muted" style="margin-bottom:16px">A: ${docA.numPages} pages · B: ${docB.numPages} pages · Comparing up to ${maxPages} pages</p><div id="pcGrid" class="compare-grid"></div>`;
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
    btn.disabled = false; btn.innerHTML = icon('eye', 16) + ' Compare';
  });
}

async function renderPageToCanvas(page, viewport) {
  const c = document.createElement('canvas');
  c.width = viewport.width; c.height = viewport.height;
  const ctx = c.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return c;
}
function pixelDiffPercent(cA, cB) {
  if (cA.width !== cB.width || cA.height !== cB.height) {
    // Resize B to A for a rough comparison
    const tmp = document.createElement('canvas');
    tmp.width = cA.width; tmp.height = cA.height;
    tmp.getContext('2d').drawImage(cB, 0, 0, cA.width, cA.height);
    cB = tmp;
  }
  const a = cA.getContext('2d').getImageData(0, 0, cA.width, cA.height).data;
  const b = cB.getContext('2d').getImageData(0, 0, cB.width, cB.height).data;
  let diff = 0, total = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]);
    if (d > 30) diff++;
  }
  return (diff / total) * 100;
}

/* ============================================================
   PDF Redact (rasterize + black boxes = true removal)
   ============================================================ */
function renderPdfRedact(root, toolId) {
  let pdfFile = null, pdfjsDoc = null, currentPage = 1, currentCanvas = null, currentViewport = null;
  let redactionsByPage = {}; // { pageNum: [ {x,y,w,h} in canvas coords ] }

  root.innerHTML = `
    <div class="panel">
      <div id="prDrop"></div>
      <div id="prWorkspace" class="hidden">
        <div class="format-note"><b>Note:</b> This rasterizes each page and permanently removes redacted content — text under boxes will not be recoverable.</div>
        <div class="redact-toolbar">
          <button id="prPrev" class="btn btn-outline btn-sm">←</button>
          <span id="prPageLabel" class="muted">Page 1 / 1</span>
          <button id="prNext" class="btn btn-outline btn-sm">→</button>
          <button id="prClearBoxes" class="btn btn-outline btn-sm">Clear boxes on this page</button>
          <button id="prGo" class="btn btn-primary btn-sm">${icon('download', 14)} Export redacted PDF</button>
        </div>
        <div class="redact-canvas-wrap">
          <div id="prCanvasStack" class="redact-canvas-stack"></div>
        </div>
        <p class="crop-hint">Click and drag over the page to draw a redaction box.</p>
      </div>
    </div>`;

  root.querySelector('#prDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop a PDF to redact',
    hint: 'Draw boxes over sensitive information',
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
    currentViewport = vp;
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    currentCanvas = c;

    const stack = root.querySelector('#prCanvasStack');
    stack.innerHTML = '';
    stack.appendChild(c);
    const overlay = document.createElement('div');
    overlay.className = 'redact-overlay';
    overlay.style.width = c.width + 'px';
    overlay.style.height = c.height + 'px';
    stack.appendChild(overlay);

    // Restore existing boxes for this page
    (redactionsByPage[n] || []).forEach((r) => overlay.appendChild(boxEl(r, overlay, n, true)));

    // Draw new box on drag
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
      const box = {
        x: rect.left - overlayRect.left,
        y: rect.top - overlayRect.top,
        w: rect.width,
        h: rect.height,
      };
      live.remove();
      if (box.w < 4 || box.h < 4) { start = null; live = null; return; }
      redactionsByPage[n] = redactionsByPage[n] || [];
      redactionsByPage[n].push(box);
      overlay.appendChild(boxEl(box, overlay, n, false));
      start = null; live = null;
    }
  }

  function boxEl(box, overlay, pageNum, isRestore) {
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
  root.querySelector('#prClearBoxes').addEventListener('click', () => {
    redactionsByPage[currentPage] = [];
    renderPage(currentPage);
  });

  root.querySelector('#prGo').addEventListener('click', async () => {
    if (!pdfjsDoc) return;
    const btn = root.querySelector('#prGo');
    btn.disabled = true; btn.textContent = 'Exporting…';
    analytics.trackToolStart(toolId);
    try {
      const { PDFDocument } = await loadPdfLib();
      const out = await PDFDocument.create();
      for (let i = 1; i <= pdfjsDoc.numPages; i++) {
        const page = await pdfjsDoc.getPage(i);
        const vp = page.getViewport({ scale: 2 }); // high res
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        const ctx = c.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        // Draw black boxes scaled to this canvas
        const scaleX = vp.width / currentViewport.width;
        const scaleY = vp.height / currentViewport.height;
        // Note: currentViewport might be a different page; recompute per-page scale
        const pageRenders = await (async () => {
          // render at low scale to get box coordinate system
          const vpLow = page.getViewport({ scale: 1.4 });
          return vpLow;
        })();
        const sx = vp.width / pageRenders.width;
        const sy = vp.height / pageRenders.height;
        const boxes = redactionsByPage[i] || [];
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
    btn.disabled = false; btn.innerHTML = icon('download', 14) + ' Export redacted PDF';
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
      <div class="format-note">
        Uses AES encryption to protect the output. <b>Note:</b> this uses a fork of pdf-lib with real encryption — some very old PDF viewers may not open the result.
      </div>
      <div class="field-group">
        <div class="field"><label>User password (required to open)</label><input type="password" id="ppUser" autocomplete="new-password"/></div>
        <div class="field"><label>Owner password (optional, for permissions)</label><input type="password" id="ppOwner" autocomplete="new-password"/></div>
      </div>
      <div class="field-group">
        <label class="checkbox-row"><input type="checkbox" id="ppAllowPrint" checked/> Allow printing</label>
        <label class="checkbox-row"><input type="checkbox" id="ppAllowCopy"/> Allow copying text</label>
      </div>
      <div class="actions">
        <button id="ppGo" class="btn btn-primary" disabled>${icon('lock', 16)} Encrypt PDF</button>
      </div>
    </div>`;
  root.querySelector('#ppDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop a PDF to protect',
    hint: 'Add a password before sharing',
    onFiles: ([f]) => { pdfFile = f; root.querySelector('#ppGo').disabled = false; toast('PDF loaded'); },
  }));
  root.querySelector('#ppGo').addEventListener('click', async () => {
    if (!pdfFile) return;
    const userPwd = root.querySelector('#ppUser').value;
    if (!userPwd) return toast('Enter a user password', 'error');
    const ownerPwd = root.querySelector('#ppOwner').value || userPwd;
    const btn = root.querySelector('#ppGo');
    btn.disabled = true; btn.textContent = 'Encrypting…';
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
      const base = pdfFile.name.replace(/\.pdf$/i, '');
      download(new Blob([bytes], { type: 'application/pdf' }), base + '_protected.pdf');
      analytics.trackToolComplete(toolId);
      analytics.trackToolDownload(toolId);
      toast('Encrypted PDF saved', 'success');
    } catch (err) {
      console.error(err); analytics.trackError(toolId, err);
      toast('Encryption failed — see console', 'error');
    }
    btn.disabled = false; btn.innerHTML = icon('lock', 16) + ' Encrypt PDF';
  });
}

/* ============================================================
   PDF Sign
   ============================================================ */
function renderPdfSign(root, toolId) {
  let pdfFile = null, pdfjsDoc = null, sigDataURL = null, currentPage = 1, currentViewport = null;
  let sigByPage = {}; // { pageNum: {x,y,w,h} }

  root.innerHTML = `
    <div class="panel">
      <div id="psDrop"></div>
      <div id="psWorkspace" class="hidden">
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
          <button id="psPrev" class="btn btn-outline btn-sm">←</button>
          <span id="psPageLabel" class="muted">Page 1 / 1</span>
          <button id="psNext" class="btn btn-outline btn-sm">→</button>
          <button id="psPlace" class="btn btn-outline btn-sm">Place signature on this page</button>
          <button id="psGo" class="btn btn-primary btn-sm">${icon('download', 14)} Export signed PDF</button>
        </div>
        <div class="redact-canvas-wrap">
          <div id="psCanvasStack" class="redact-canvas-stack"></div>
        </div>
      </div>
    </div>`;

  root.querySelector('#psDrop').appendChild(makeDropZone({
    accept: '.pdf,application/pdf', multiple: false,
    title: 'Drop a PDF to sign',
    hint: 'Draw a signature and place it on any page',
    onFiles: ([f]) => load(f),
  }));

  // Signature pad
  const pad = root.querySelector('#sigPad');
  const padCtx = pad.getContext('2d');
  let drawing = false;
  function pos(e) {
    const r = pad.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (pad.width / r.width), y: (t.clientY - r.top) * (pad.height / r.height) };
  }
  function start(e) { e.preventDefault(); drawing = true; const p = pos(e); padCtx.beginPath(); padCtx.moveTo(p.x, p.y); }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    padCtx.lineWidth = 3;
    padCtx.lineCap = 'round';
    padCtx.strokeStyle = '#0f172a';
    padCtx.lineTo(p.x, p.y);
    padCtx.stroke();
  }
  function end() { drawing = false; sigDataURL = pad.toDataURL('image/png'); }
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
    root.querySelector('#psWorkspace').classList.remove('hidden');
    sigByPage = {};
    await renderPage(1);
  }

  async function renderPage(n) {
    currentPage = n;
    root.querySelector('#psPageLabel').textContent = 'Page ' + n + ' / ' + pdfjsDoc.numPages;
    const page = await pdfjsDoc.getPage(n);
    const vp = page.getViewport({ scale: 1.4 });
    currentViewport = vp;
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;

    const stack = root.querySelector('#psCanvasStack');
    stack.innerHTML = '';
    stack.appendChild(c);

    // Overlay with signature preview if placed
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
      // Allow dragging
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

  root.querySelector('#psPlace').addEventListener('click', () => {
    if (!sigDataURL) return toast('Draw or upload a signature first', 'error');
    sigByPage[currentPage] = { x: 40, y: 40, w: 200 };
    renderPage(currentPage);
  });
  root.querySelector('#psPrev').addEventListener('click', () => { if (currentPage > 1) renderPage(currentPage - 1); });
  root.querySelector('#psNext').addEventListener('click', () => { if (currentPage < pdfjsDoc.numPages) renderPage(currentPage + 1); });

  root.querySelector('#psGo').addEventListener('click', async () => {
    if (!pdfjsDoc) return;
    const btn = root.querySelector('#psGo');
    btn.disabled = true; btn.textContent = 'Exporting…';
    analytics.trackToolStart(toolId);
    try {
      const { PDFDocument } = await loadPdfLib();
      const buf = await readAsArrayBuffer(pdfFile);
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = pdf.getPages();

      for (let i = 1; i <= pdfjsDoc.numPages; i++) {
        const sig = sigByPage[i];
        if (!sig || !sigDataURL) continue;
        // Get low-res viewport for coordinate scaling
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
          y: target.height - (sig.y * sy) - sigH, // PDF origin is bottom-left
          width: sigW,
          height: sigH,
        });
      }

      const bytes = await pdf.save();
      const base = pdfFile.name.replace(/\.pdf$/i, '');
      download(new Blob([bytes], { type: 'application/pdf' }), base + '_signed.pdf');
      analytics.trackToolComplete(toolId);
      analytics.trackToolDownload(toolId);
      toast('Signed PDF saved', 'success');
    } catch (err) {
      console.error(err); analytics.trackError(toolId, err); toast('Signing failed', 'error');
    }
    btn.disabled = false; btn.innerHTML = icon('download', 14) + ' Export signed PDF';
  });
}

export const PDF_TOOLS = {
  'creator':  { name: 'Creator',        render: renderPdfCreator },
  'merge':    { name: 'Merge',          render: renderPdfMerge },
  'split':    { name: 'Split',          render: renderPdfSplit },
  'compare':  { name: 'Compare',        render: renderPdfCompare },
  'redact':   { name: 'Redact',         render: renderPdfRedact },
  'password': { name: 'Password',       render: renderPdfPassword },
  'sign':     { name: 'Sign',           render: renderPdfSign },
};