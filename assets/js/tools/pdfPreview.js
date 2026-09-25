import { escapeHTML } from '../utils.js';

/* ============================================================
   createPageSwitcher
   ------------------------------------------------------------
   Renders a two-pane widget:
   - Left: reorder grid of thumbnails (dominant, 2/3)
   - Right: preview of the currently-selected page (smaller, 1/3)

   Options:
     pages              [{ id, label, thumbnail }]
     selectable         boolean — show checkboxes on thumbnails
     selectedIds        string[] — initial selection
     allowDelete        boolean — show × on hover
     onChange(pages)    called after reorder or delete
     onSelectionChange  called when a thumbnail is toggled
     onDelete(id)       called before a page is removed
     onPageChange(idx)  called when the active thumbnail changes

   Returns:
     { setPages, getPages, getSelectedIds, setSelection, setActive }
   ============================================================ */
export function createPageSwitcher(container, opts = {}) {
  let pages = (opts.pages || []).slice();
  let selectedIds = new Set(opts.selectedIds || []);
  let currentIndex = 0;
  const selectable = !!opts.selectable;
  const allowDelete = !!opts.allowDelete;

  container.innerHTML = `
    <div class="ps-shell">
      <div class="ps-strip-wrap">
        <div class="ps-strip" id="psStrip" role="list"></div>
        <p class="ps-hint">${
          [
            'Drag to reorder',
            selectable ? 'Click to select' : null,
            allowDelete ? 'Hover to remove' : null,
          ].filter(Boolean).join(' · ')
        }</p>
      </div>
      <div class="ps-viewer">
        <div class="ps-viewer-inner" id="psViewer"></div>
        <div class="ps-viewer-nav">
          <button type="button" class="btn btn-outline btn-sm" id="psPrev" aria-label="Previous page">←</button>
          <span class="ps-page-counter" id="psCounter">0 / 0</span>
          <button type="button" class="btn btn-outline btn-sm" id="psNext" aria-label="Next page">→</button>
        </div>
      </div>
    </div>`;

  const viewer = container.querySelector('#psViewer');
  const strip = container.querySelector('#psStrip');
  const counter = container.querySelector('#psCounter');

  function render() {
    if (!pages.length) {
      viewer.innerHTML = '<div class="ps-empty">No pages yet</div>';
      strip.innerHTML = '';
      counter.textContent = '0 / 0';
      return;
    }

    if (currentIndex >= pages.length) currentIndex = pages.length - 1;
    if (currentIndex < 0) currentIndex = 0;

    const p = pages[currentIndex];
    viewer.innerHTML = p.thumbnail
      ? `<img src="${p.thumbnail}" alt="${escapeHTML(p.label || 'Page ' + (currentIndex + 1))}" />`
      : `<div class="ps-empty">${escapeHTML(p.label || 'Page')}</div>`;
    counter.textContent = (currentIndex + 1) + ' / ' + pages.length;

    strip.innerHTML = pages.map((pg, i) => `
      <div class="ps-thumb ${i === currentIndex ? 'active' : ''} ${selectedIds.has(pg.id) ? 'selected' : ''}"
           data-i="${i}" draggable="true" role="listitem">
        ${pg.thumbnail ? `<img src="${pg.thumbnail}" alt="" />` : '<div class="ps-thumb-empty"></div>'}
        <span class="ps-thumb-num">${i + 1}</span>
        ${allowDelete ? `<button type="button" class="ps-thumb-rm" data-rm="${i}" aria-label="Remove">×</button>` : ''}
        ${selectable ? `<span class="ps-thumb-check">${selectedIds.has(pg.id) ? '✓' : ''}</span>` : ''}
      </div>`).join('');

    // Click behaviour
    strip.querySelectorAll('.ps-thumb').forEach((el) => {
      const i = +el.dataset.i;
      el.addEventListener('click', (e) => {
        if (e.target.closest('.ps-thumb-rm')) return;
        if (selectable) {
          const id = pages[i].id;
          if (selectedIds.has(id)) selectedIds.delete(id);
          else selectedIds.add(id);
          if (opts.onSelectionChange) opts.onSelectionChange([...selectedIds]);
        } else {
          currentIndex = i;
          if (opts.onPageChange) opts.onPageChange(i);
        }
        render();
      });
    });

    // Delete buttons
    strip.querySelectorAll('.ps-thumb-rm').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = +b.dataset.rm;
        const removed = pages[i];
        pages.splice(i, 1);
        if (currentIndex >= pages.length) currentIndex = Math.max(0, pages.length - 1);
        if (opts.onDelete) opts.onDelete(removed.id);
        if (opts.onChange) opts.onChange(pages.slice());
        render();
      });
    });

    // Drag-to-reorder
    let dragIdx = null;
    strip.querySelectorAll('.ps-thumb').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        dragIdx = +el.dataset.i;
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drop-target');
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drop-target');
        const target = +el.dataset.i;
        if (dragIdx === null || target === dragIdx) return;
        const [moved] = pages.splice(dragIdx, 1);
        pages.splice(target, 0, moved);
        if (currentIndex === dragIdx) currentIndex = target;
        else if (dragIdx < currentIndex && target >= currentIndex) currentIndex--;
        else if (dragIdx > currentIndex && target <= currentIndex) currentIndex++;
        if (opts.onChange) opts.onChange(pages.slice());
        render();
      });
    });
  }

  container.querySelector('#psPrev').addEventListener('click', () => {
    if (currentIndex > 0) {
      currentIndex--;
      if (opts.onPageChange) opts.onPageChange(currentIndex);
      render();
    }
  });
  container.querySelector('#psNext').addEventListener('click', () => {
    if (currentIndex < pages.length - 1) {
      currentIndex++;
      if (opts.onPageChange) opts.onPageChange(currentIndex);
      render();
    }
  });

  render();

  return {
    setPages(next) {
      pages = next.slice();
      if (currentIndex >= pages.length) currentIndex = Math.max(0, pages.length - 1);
      render();
    },
    getPages() { return pages.slice(); },
    getSelectedIds() { return [...selectedIds]; },
    setSelection(ids) { selectedIds = new Set(ids); render(); },
    setActive(idx) { currentIndex = Math.max(0, Math.min(idx, pages.length - 1)); render(); },
  };
}

/* ============================================================
   rasterizePdfPage — pdf.js doc → JPEG data URL
   ============================================================ */
export async function rasterizePdfPage(pdfDoc, pageNum, scale = 0.35) {
  const page = await pdfDoc.getPage(pageNum);
  const vp = page.getViewport({ scale });
  const cvs = document.createElement('canvas');
  cvs.width = Math.max(1, Math.floor(vp.width));
  cvs.height = Math.max(1, Math.floor(vp.height));
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cvs.width, cvs.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return cvs.toDataURL('image/jpeg', 0.7);
}

/* ============================================================
   rasterizeImageDataURL — image data URL (for Creator)
   ============================================================ */
export function rasterizeImageDataURL(dataURL, maxW = 300) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth);
      const cvs = document.createElement('canvas');
      cvs.width = Math.max(1, Math.floor(img.naturalWidth * scale));
      cvs.height = Math.max(1, Math.floor(img.naturalHeight * scale));
      const ctx = cvs.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cvs.width, cvs.height);
      ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
      resolve(cvs.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => resolve(null);
    img.src = dataURL;
  });
}

/* ============================================================
   rasterizeTextPage — for Creator's text-only pages
   ============================================================ */
export function rasterizeTextPage(text, maxW = 300) {
  const cvs = document.createElement('canvas');
  cvs.width = maxW;
  cvs.height = Math.floor(maxW * 1.414); // A4 ratio
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cvs.width, cvs.height);
  ctx.fillStyle = '#0f172a';
  ctx.font = '8px -apple-system, sans-serif';
  const lines = (text || '').split('\n').slice(0, 60);
  lines.forEach((line, i) => {
    ctx.fillText(line.slice(0, 60), 14, 24 + i * 10);
  });
  return cvs.toDataURL('image/jpeg', 0.7);
}