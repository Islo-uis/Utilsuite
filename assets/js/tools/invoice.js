import { analytics } from '../analytics.js';
import { $, icon, toast, download, escapeHTML, readAsDataURL } from '../utils.js';

const STORAGE_KEY = 'utility-suite:invoices';
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'PHP', 'INR', 'SGD', 'CHF', 'MXN', 'BRL', 'ZAR'];
const STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];

/* ---------- Storage ---------- */
function loadInvoices() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function saveInvoices(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}
function newId() {
  return 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}
function nextInvoiceNumber(list) {
  const nums = list.map((i) => {
    const m = /(\d+)\s*$/.exec(i.meta.number || '');
    return m ? parseInt(m[1], 10) : 0;
  });
  const max = nums.length ? Math.max(...nums) : 0;
  return 'INV-' + String(max + 1).padStart(4, '0');
}
function formatMoney(n, cur = 'USD') {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n || 0); }
  catch { return (cur || '') + ' ' + (n || 0).toFixed(2); }
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDaysISO(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ---------- Empty invoice template ---------- */
function blankInvoice(list, preset) {
  const issue = todayISO();
  return {
    id: newId(),
    meta: {
      number: nextInvoiceNumber(list),
      issueDate: issue,
      dueDate: addDaysISO(issue, 30),
      status: 'draft',
      currency: 'USD',
      poNumber: '',
    },
    business: preset?.business || { name: '', address: '', email: '', phone: '', website: '', taxId: '', logoDataUrl: null },
    client: { name: '', address: '', email: '', phone: '' },
    items: [{ id: newId(), description: '', quantity: 1, unitPrice: 0, taxRate: 0 }],
    totals: { discountType: 'flat', discountValue: 0, shipping: 0 },
    notes: preset?.notes || { paymentTerms: 'Net 30', paymentDetails: '', notes: 'Thank you for your business.' },
    signature: { dataUrl: null, label: 'Authorized Signature', showName: '' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/* ---------- Totals calculation ---------- */
function computeTotals(inv) {
  let subtotal = 0, taxTotal = 0;
  inv.items.forEach((it) => {
    const line = (it.quantity || 0) * (it.unitPrice || 0);
    subtotal += line;
    taxTotal += line * ((it.taxRate || 0) / 100);
  });
  let discount = 0;
  if (inv.totals.discountType === 'percent') discount = subtotal * ((inv.totals.discountValue || 0) / 100);
  else discount = inv.totals.discountValue || 0;
  const taxable = subtotal - discount;
  if (discount > 0 && subtotal > 0) taxTotal = taxTotal * (taxable / subtotal);
  const total = taxable + taxTotal + (inv.totals.shipping || 0);
  return { subtotal, discount, taxTotal, shipping: inv.totals.shipping || 0, total };
}

/* ============================================================
   MAIN RENDERER
   ============================================================ */
export function renderInvoice(root, toolId) {
  let invoices = loadInvoices();
  let current = null;
  let activeTab = 'editor';

  root.innerHTML = layout();
  wire();

  function layout() {
    return `
      <div class="invoice-shell">
        <div class="invoice-stats" id="invStats"></div>
        <div class="invoice-tabs">
          <button class="inv-tab active" data-tab="editor">New invoice</button>
          <button class="inv-tab" data-tab="history">History <span class="inv-count" id="invCount">0</span></button>
          <button class="inv-tab" data-tab="dashboard">Reports</button>
        </div>
        <div class="inv-panel" id="invPanel"></div>
      </div>`;
  }

  function wire() {
    root.querySelectorAll('.inv-tab').forEach((b) => b.addEventListener('click', () => {
      activeTab = b.dataset.tab;
      root.querySelectorAll('.inv-tab').forEach((x) => x.classList.toggle('active', x === b));
      renderTab();
    }));
    renderStats();
    renderTab();
  }

  function renderStats() {
    const paid = invoices.filter((i) => i.meta.status === 'paid');
    const outstanding = invoices.filter((i) => ['sent', 'overdue'].includes(i.meta.status));
    const overdue = invoices.filter((i) => i.meta.status === 'overdue');
    const totalPaid = paid.reduce((s, i) => s + computeTotals(i).total, 0);
    const totalOut = outstanding.reduce((s, i) => s + computeTotals(i).total, 0);
    const totalOverdue = overdue.reduce((s, i) => s + computeTotals(i).total, 0);
    const cur = current?.meta.currency || invoices[0]?.meta.currency || 'USD';

    root.querySelector('#invStats').innerHTML = `
      <div class="inv-stat">
        <div class="lbl">Total invoiced</div>
        <div class="val">${formatMoney(invoices.reduce((s, i) => s + computeTotals(i).total, 0), cur)}</div>
        <div class="sub">${invoices.length} invoice${invoices.length === 1 ? '' : 's'}</div>
      </div>
      <div class="inv-stat ok">
        <div class="lbl">Paid</div>
        <div class="val">${formatMoney(totalPaid, cur)}</div>
        <div class="sub">${paid.length} paid</div>
      </div>
      <div class="inv-stat warn">
        <div class="lbl">Outstanding</div>
        <div class="val">${formatMoney(totalOut, cur)}</div>
        <div class="sub">${outstanding.length} awaiting payment</div>
      </div>
      <div class="inv-stat danger">
        <div class="lbl">Overdue</div>
        <div class="val">${formatMoney(totalOverdue, cur)}</div>
        <div class="sub">${overdue.length} past due</div>
      </div>`;
    root.querySelector('#invCount').textContent = invoices.length;
  }

  function renderTab() {
    const panel = root.querySelector('#invPanel');
    if (activeTab === 'editor') renderEditor(panel);
    else if (activeTab === 'history') renderHistory(panel);
    else renderReports(panel);
  }

  /* ----------------------------------------------------------
     EDITOR TAB
     ---------------------------------------------------------- */
  function renderEditor(panel) {
    if (!current) {
      const preset = invoices[0] ? { business: invoices[0].business, notes: invoices[0].notes } : null;
      current = blankInvoice(invoices, preset);
    }

    panel.innerHTML = `
      <form class="inv-editor" id="invForm" autocomplete="off" novalidate>
        <div class="inv-editor-form">

          <details class="inv-section" open>
            <summary>Invoice details</summary>
            <div class="inv-section-body">
              <div class="inv-grid">
                <div class="field-row"><label>Number</label>
                  <input type="text" data-bind="meta.number" value="${escapeHTML(current.meta.number)}"/>
                </div>
                <div class="field-row"><label>Status</label>
                  <select data-bind="meta.status">
                    ${STATUSES.map((s) => `<option value="${s}" ${s === current.meta.status ? 'selected' : ''}>${s}</option>`).join('')}
                  </select>
                </div>
                <div class="field-row"><label>Currency</label>
                  <select data-bind="meta.currency">
                    ${CURRENCIES.map((c) => `<option value="${c}" ${c === current.meta.currency ? 'selected' : ''}>${c}</option>`).join('')}
                  </select>
                </div>
                <div class="field-row"><label>Issue date</label>
                  <input type="date" data-bind="meta.issueDate" value="${current.meta.issueDate}"/>
                </div>
                <div class="field-row"><label>Due date</label>
                  <input type="date" data-bind="meta.dueDate" value="${current.meta.dueDate}"/>
                </div>
                <div class="field-row"><label>PO number</label>
                  <input type="text" data-bind="meta.poNumber" value="${escapeHTML(current.meta.poNumber)}" placeholder="Optional"/>
                </div>
              </div>
            </div>
          </details>

          <details class="inv-section" open>
            <summary>From &amp; Bill to</summary>
            <div class="inv-section-body">
              <div class="inv-two-col">
                <div>
                  <div class="inv-logo-row">
                    ${current.business.logoDataUrl
                      ? `<img src="${current.business.logoDataUrl}" class="inv-logo-preview" alt="Logo"/>`
                      : `<div class="inv-logo-placeholder">No logo</div>`}
                    <div style="display:flex;flex-direction:column;gap:6px">
                      <label class="btn btn-outline btn-sm" style="cursor:pointer">
                        ${icon('upload', 14)} ${current.business.logoDataUrl ? 'Replace' : 'Logo'}
                        <input type="file" id="invLogoUpload" accept="image/*" class="hidden"/>
                      </label>
                      ${current.business.logoDataUrl ? `<button type="button" class="btn btn-outline btn-sm" id="invLogoRemove">Remove</button>` : ''}
                    </div>
                  </div>
                  <div class="field-row"><label>Business name</label>
                    <input type="text" data-bind="business.name" value="${escapeHTML(current.business.name)}"/>
                  </div>
                  <div class="field-row" style="margin-top:10px"><label>Address</label>
                    <textarea data-bind="business.address" rows="2">${escapeHTML(current.business.address)}</textarea>
                  </div>
                  <div class="inv-grid" style="margin-top:10px">
                    <div class="field-row"><label>Email</label><input type="text" data-bind="business.email" value="${escapeHTML(current.business.email)}"/></div>
                    <div class="field-row"><label>Phone</label><input type="text" data-bind="business.phone" value="${escapeHTML(current.business.phone)}"/></div>
                    <div class="field-row"><label>Website</label><input type="text" data-bind="business.website" value="${escapeHTML(current.business.website)}"/></div>
                    <div class="field-row"><label>Tax ID</label><input type="text" data-bind="business.taxId" value="${escapeHTML(current.business.taxId)}"/></div>
                  </div>
                </div>
                <div>
                  <div class="field-row"><label>Client name</label>
                    <input type="text" data-bind="client.name" value="${escapeHTML(current.client.name)}"/>
                  </div>
                  <div class="field-row" style="margin-top:10px"><label>Address</label>
                    <textarea data-bind="client.address" rows="2">${escapeHTML(current.client.address)}</textarea>
                  </div>
                  <div class="inv-grid" style="margin-top:10px">
                    <div class="field-row"><label>Email</label><input type="text" data-bind="client.email" value="${escapeHTML(current.client.email)}"/></div>
                    <div class="field-row"><label>Phone</label><input type="text" data-bind="client.phone" value="${escapeHTML(current.client.phone)}"/></div>
                  </div>
                </div>
              </div>
            </div>
          </details>

          <details class="inv-section" open>
            <summary>Line items</summary>
            <div class="inv-section-body">
              <div class="inv-items-header">
                <span>Description</span><span>Qty</span><span>Unit</span><span>Tax %</span><span>Total</span><span></span>
              </div>
              <div id="invItems"></div>
              <button type="button" class="btn btn-outline btn-sm" id="invAddItem" style="align-self:flex-start;margin-top:8px">+ Add line</button>
            </div>
          </details>

          <details class="inv-section">
            <summary>Discount &amp; shipping</summary>
            <div class="inv-section-body">
              <div class="inv-grid">
                <div class="field-row"><label>Type</label>
                  <select data-bind="totals.discountType">
                    <option value="flat" ${current.totals.discountType === 'flat' ? 'selected' : ''}>Flat amount</option>
                    <option value="percent" ${current.totals.discountType === 'percent' ? 'selected' : ''}>Percentage</option>
                  </select>
                </div>
                <div class="field-row"><label>Value</label><input type="number" step="0.01" min="0" data-bind="totals.discountValue" value="${current.totals.discountValue}"/></div>
                <div class="field-row"><label>Shipping</label><input type="number" step="0.01" min="0" data-bind="totals.shipping" value="${current.totals.shipping}"/></div>
              </div>
              <div class="inv-totals-right" id="invTotals" style="margin-top:12px"></div>
            </div>
          </details>

          <details class="inv-section">
            <summary>Payment terms &amp; notes</summary>
            <div class="inv-section-body">
              <div class="field-row"><label>Payment terms</label><input type="text" data-bind="notes.paymentTerms" value="${escapeHTML(current.notes.paymentTerms)}" placeholder="e.g. Net 30"/></div>
              <div class="field-row"><label>Payment details</label><textarea data-bind="notes.paymentDetails" rows="2" placeholder="Bank / IBAN / PayPal…">${escapeHTML(current.notes.paymentDetails)}</textarea></div>
              <div class="field-row"><label>Closing note</label><textarea data-bind="notes.notes" rows="2">${escapeHTML(current.notes.notes)}</textarea></div>
            </div>
          </details>

          <details class="inv-section">
            <summary>Signature</summary>
            <div class="inv-section-body">
              <div class="inv-two-col">
                <div>
                  <p class="muted" style="margin-bottom:8px">Draw your signature.</p>
                  <canvas id="invSigPad" width="600" height="140" class="inv-sig-pad"></canvas>
                  <div class="sig-actions" style="margin-top:8px">
                    <button type="button" class="btn btn-outline btn-sm" id="invSigClear">Clear</button>
                    <label class="btn btn-outline btn-sm" style="cursor:pointer">
                      ${icon('upload', 14)} Upload
                      <input type="file" id="invSigUpload" accept="image/png,image/*" class="hidden"/>
                    </label>
                  </div>
                </div>
                <div>
                  <div class="field-row"><label>Label</label><input type="text" data-bind="signature.label" value="${escapeHTML(current.signature.label)}"/></div>
                  <div class="field-row" style="margin-top:10px"><label>Printed name</label><input type="text" data-bind="signature.showName" value="${escapeHTML(current.signature.showName)}"/></div>
                </div>
              </div>
            </div>
          </details>

        </div>

        <aside class="inv-editor-preview">
          <div class="inv-preview-header">
            <span><span class="dot-live"></span>Live preview</span>
          </div>
          <div class="inv-preview-paper" id="invPreview"></div>
        </aside>

        <div class="inv-editor-actions">
          <button type="button" class="btn btn-outline" id="invReset">Reset</button>
          <button type="button" class="btn btn-outline" id="invSave">${icon('archive', 16)} Save</button>
          <button type="button" class="btn btn-primary" id="invPdf">${icon('download', 16)} Download PDF</button>
        </div>
      </form>`;

    bindForm();
    renderItems();
    renderTotals();
    initSigPad();
    renderLivePreview();
  }

  /* ----------------------------------------------------------
     LIVE PREVIEW — mirrors the PDF layout
     ---------------------------------------------------------- */
  function renderLivePreview() {
    const el = root.querySelector('#invPreview');
    if (!el) return;
    const inv = current;
    const t = computeTotals(inv);
    const cur = inv.meta.currency;
    const addrLines = (s) => (s || '').split('\n').filter(Boolean).map((l) => `<div>${escapeHTML(l)}</div>`).join('');

    el.innerHTML = `
      <div class="inv-doc">
        <div class="inv-doc-head">
          <div class="inv-doc-logo">${inv.business.logoDataUrl ? `<img src="${inv.business.logoDataUrl}" alt=""/>` : ''}</div>
          <div class="inv-doc-title">
            <div class="inv-doc-h1">INVOICE</div>
            <div class="inv-doc-num">#${escapeHTML(inv.meta.number)}</div>
          </div>
        </div>

        <div class="inv-doc-parties">
          <div>
            <div class="inv-doc-label">From</div>
            <div class="inv-doc-party">${inv.business.name ? escapeHTML(inv.business.name) : '<span class="inv-doc-empty">Your business</span>'}</div>
            <div class="inv-doc-meta">
              ${addrLines(inv.business.address)}
              ${inv.business.email ? `<div>${escapeHTML(inv.business.email)}</div>` : ''}
              ${inv.business.phone ? `<div>${escapeHTML(inv.business.phone)}</div>` : ''}
              ${inv.business.taxId ? `<div>Tax ID: ${escapeHTML(inv.business.taxId)}</div>` : ''}
            </div>
          </div>
          <div>
            <div class="inv-doc-label">Bill to</div>
            <div class="inv-doc-party">${inv.client.name ? escapeHTML(inv.client.name) : '<span class="inv-doc-empty">Client name</span>'}</div>
            <div class="inv-doc-meta">
              ${addrLines(inv.client.address)}
              ${inv.client.email ? `<div>${escapeHTML(inv.client.email)}</div>` : ''}
              ${inv.client.phone ? `<div>${escapeHTML(inv.client.phone)}</div>` : ''}
            </div>
          </div>
        </div>

        <div class="inv-doc-meta-strip">
          <div><span>Issue</span><b>${fmtDate(inv.meta.issueDate)}</b></div>
          <div><span>Due</span><b>${fmtDate(inv.meta.dueDate)}</b></div>
          <div><span>Status</span><b>${inv.meta.status}</b></div>
          ${inv.meta.poNumber ? `<div><span>PO</span><b>${escapeHTML(inv.meta.poNumber)}</b></div>` : ''}
        </div>

        <table class="inv-doc-items">
          <thead>
            <tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr>
          </thead>
          <tbody>
            ${inv.items.map((it) => `
              <tr>
                <td>${it.description ? escapeHTML(it.description) : '<span class="inv-doc-empty">—</span>'}</td>
                <td class="num">${it.quantity}</td>
                <td class="num">${formatMoney(it.unitPrice, cur)}</td>
                <td class="num">${formatMoney((it.quantity || 0) * (it.unitPrice || 0), cur)}</td>
              </tr>`).join('')}
          </tbody>
        </table>

        <div class="inv-doc-totals">
          <div><span>Subtotal</span><b>${formatMoney(t.subtotal, cur)}</b></div>
          ${t.discount > 0 ? `<div><span>Discount</span><b>−${formatMoney(t.discount, cur)}</b></div>` : ''}
          ${t.taxTotal > 0 ? `<div><span>Tax</span><b>${formatMoney(t.taxTotal, cur)}</b></div>` : ''}
          ${t.shipping > 0 ? `<div><span>Shipping</span><b>${formatMoney(t.shipping, cur)}</b></div>` : ''}
          <div class="grand"><span>Total</span><b>${formatMoney(t.total, cur)}</b></div>
        </div>

        ${inv.signature.dataUrl ? `
          <div class="inv-doc-signature">
            <img src="${inv.signature.dataUrl}" alt="Signature"/>
            <div class="inv-doc-sigline">${escapeHTML(inv.signature.label || 'Signature')}</div>
            ${inv.signature.showName ? `<div class="inv-doc-signame">${escapeHTML(inv.signature.showName)}</div>` : ''}
          </div>` : ''}
      </div>`;
  }

  /* ----------------------------------------------------------
     FORM BINDING
     ---------------------------------------------------------- */
  function bindForm() {
    const form = root.querySelector('#invForm');

    form.querySelectorAll('[data-bind]').forEach((el) => {
      el.addEventListener('input', () => {
        const path = el.dataset.bind.split('.');
        let obj = current;
        for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
        const key = path[path.length - 1];
        obj[key] = el.type === 'number' ? (parseFloat(el.value) || 0) : el.value;
        current.updatedAt = Date.now();
        if (path[0] === 'meta' || path[0] === 'totals') { renderTotals(); renderStats(); }
        renderLivePreview();
      });
    });

    // Logo upload
    const logoInput = root.querySelector('#invLogoUpload');
    if (logoInput) logoInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (!f.type.startsWith('image/')) return toast('Select an image file', 'error');
      try {
        current.business.logoDataUrl = await readAsDataURL(f);
        // Re-render just the logo row + preview
        renderEditor(root.querySelector('#invPanel'));
      } catch { toast('Could not load logo', 'error'); }
    });
    const logoRemove = root.querySelector('#invLogoRemove');
    if (logoRemove) logoRemove.addEventListener('click', () => {
      current.business.logoDataUrl = null;
      renderEditor(root.querySelector('#invPanel'));
    });

    // Line items — add
    root.querySelector('#invAddItem').addEventListener('click', () => {
      current.items.push({ id: newId(), description: '', quantity: 1, unitPrice: 0, taxRate: 0 });
      renderItems();
      renderTotals();
      renderLivePreview();
    });

    // Signature — upload
    const sigInput = root.querySelector('#invSigUpload');
    if (sigInput) sigInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const dataUrl = await readAsDataURL(f);
        current.signature.dataUrl = dataUrl;
        const pad = root.querySelector('#invSigPad');
        const ctx = pad.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, pad.width, pad.height);
        const img = new Image();
        img.onload = () => {
          const r = Math.min(pad.width / img.width, pad.height / img.height) * 0.9;
          const w = img.width * r, h = img.height * r;
          ctx.drawImage(img, (pad.width - w) / 2, (pad.height - h) / 2, w, h);
          renderLivePreview();
        };
        img.src = dataUrl;
      } catch { toast('Could not load signature', 'error'); }
    });

    // Actions
    root.querySelector('#invReset').addEventListener('click', () => {
      if (!confirm('Reset the current invoice? Unsaved changes will be lost.')) return;
      current = blankInvoice(invoices, null);
      renderEditor(root.querySelector('#invPanel'));
    });
    root.querySelector('#invSave').addEventListener('click', () => saveCurrent());
    root.querySelector('#invPdf').addEventListener('click', () => {
      generatePDF(current);
      analytics.trackToolDownload(toolId);
    });
  }

  function saveCurrent() {
    const idx = invoices.findIndex((i) => i.id === current.id);
    current.updatedAt = Date.now();
    if (idx >= 0) invoices[idx] = current;
    else invoices.unshift(current);
    saveInvoices(invoices);
    renderStats();
    toast('Saved to history', 'success');
    analytics.trackToolComplete(toolId);
  }

  /* ----------------------------------------------------------
     ITEMS RENDERER
     ---------------------------------------------------------- */
  function renderItems() {
    const wrap = root.querySelector('#invItems');
    wrap.innerHTML = current.items.map((it, i) => `
      <div class="inv-item-row" data-i="${i}">
        <input type="text" placeholder="Description of service or product" data-item="description" value="${escapeHTML(it.description)}"/>
        <input type="number" step="0.01" min="0" data-item="quantity" value="${it.quantity}"/>
        <input type="number" step="0.01" min="0" data-item="unitPrice" value="${it.unitPrice}"/>
        <input type="number" step="0.01" min="0" max="100" data-item="taxRate" value="${it.taxRate}"/>
        <span class="inv-line-total">${formatMoney((it.quantity || 0) * (it.unitPrice || 0), current.meta.currency)}</span>
        <button type="button" class="inv-item-remove" data-remove="${i}" aria-label="Remove">${icon('x', 12)}</button>
      </div>`).join('');

    wrap.querySelectorAll('[data-item]').forEach((el) => el.addEventListener('input', (e) => {
      const row = e.target.closest('.inv-item-row');
      const i = +row.dataset.i;
      const field = e.target.dataset.item;
      current.items[i][field] = field === 'description' ? e.target.value : (parseFloat(e.target.value) || 0);
      row.querySelector('.inv-line-total').textContent =
        formatMoney((current.items[i].quantity || 0) * (current.items[i].unitPrice || 0), current.meta.currency);
      renderTotals();
      renderStats();
      renderLivePreview();
    }));

    wrap.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      if (current.items.length === 1) return toast('At least one line item required', 'error');
      current.items.splice(+b.dataset.remove, 1);
      renderItems();
      renderTotals();
      renderLivePreview();
    }));
  }

  /* ----------------------------------------------------------
     TOTALS RENDERER
     ---------------------------------------------------------- */
  function renderTotals() {
    const t = computeTotals(current);
    const cur = current.meta.currency;
    const el = root.querySelector('#invTotals');
    if (!el) return;
    el.innerHTML = `
      <div class="inv-total-row"><span>Subtotal</span><span>${formatMoney(t.subtotal, cur)}</span></div>
      ${t.discount > 0 ? `<div class="inv-total-row"><span>Discount</span><span>−${formatMoney(t.discount, cur)}</span></div>` : ''}
      ${t.taxTotal > 0 ? `<div class="inv-total-row"><span>Tax</span><span>${formatMoney(t.taxTotal, cur)}</span></div>` : ''}
      ${t.shipping > 0 ? `<div class="inv-total-row"><span>Shipping</span><span>${formatMoney(t.shipping, cur)}</span></div>` : ''}
      <div class="inv-total-row grand"><span>Total due</span><span>${formatMoney(t.total, cur)}</span></div>`;
  }

  /* ----------------------------------------------------------
     SIGNATURE PAD
     ---------------------------------------------------------- */
  function initSigPad() {
    const pad = root.querySelector('#invSigPad');
    if (!pad) return;
    const ctx = pad.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pad.width, pad.height);

    if (current.signature.dataUrl) {
      const img = new Image();
      img.onload = () => {
        const r = Math.min(pad.width / img.width, pad.height / img.height) * 0.9;
        const w = img.width * r, h = img.height * r;
        ctx.drawImage(img, (pad.width - w) / 2, (pad.height - h) / 2, w, h);
      };
      img.src = current.signature.dataUrl;
    }

    let drawing = false;
    const pos = (e) => {
      const r = pad.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: (t.clientX - r.left) * (pad.width / r.width), y: (t.clientY - r.top) * (pad.height / r.height) };
    };
    const start = (e) => { e.preventDefault(); drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const move = (e) => {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#0f172a';
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    };
    const end = () => {
      if (!drawing) return;
      drawing = false;
      current.signature.dataUrl = pad.toDataURL('image/png');
      renderLivePreview();
    };

    pad.addEventListener('mousedown', start);
    pad.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    pad.addEventListener('touchstart', start, { passive: false });
    pad.addEventListener('touchmove', move, { passive: false });
    pad.addEventListener('touchend', end);

    const clearBtn = root.querySelector('#invSigClear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pad.width, pad.height);
      current.signature.dataUrl = null;
      renderLivePreview();
    });
  }

  /* ----------------------------------------------------------
     HISTORY TAB
     ---------------------------------------------------------- */
  function renderHistory(panel) {
    if (!invoices.length) {
      panel.innerHTML = `<div class="empty-state">
        <p>No saved invoices yet.</p>
        <p class="muted" style="margin-top:8px">Create your first invoice and click "Save".</p>
      </div>`;
      return;
    }
    const rows = invoices.map((inv) => {
      const t = computeTotals(inv);
      return `
        <tr data-id="${inv.id}">
          <td><span class="inv-num">${escapeHTML(inv.meta.number)}</span></td>
          <td>${escapeHTML(inv.client.name || '—')}</td>
          <td>${fmtDate(inv.meta.issueDate)}</td>
          <td>${fmtDate(inv.meta.dueDate)}</td>
          <td><span class="inv-status inv-status-${inv.meta.status}">${inv.meta.status}</span></td>
          <td class="num">${formatMoney(t.total, inv.meta.currency)}</td>
          <td class="inv-row-actions">
            <button class="btn btn-outline btn-sm" data-act="edit" data-id="${inv.id}">Edit</button>
            <button class="btn btn-outline btn-sm" data-act="pdf" data-id="${inv.id}">PDF</button>
            <button class="btn btn-outline btn-sm" data-act="dup" data-id="${inv.id}">Duplicate</button>
            <button class="btn btn-outline btn-sm danger" data-act="del" data-id="${inv.id}">Delete</button>
          </td>
        </tr>`;
    }).join('');

    panel.innerHTML = `
      <div class="inv-history-wrap">
        <table class="data-table inv-history">
          <thead><tr><th>Number</th><th>Client</th><th>Issued</th><th>Due</th><th>Status</th><th class="num">Total</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    panel.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const inv = invoices.find((x) => x.id === b.dataset.id);
      if (!inv) return;
      if (b.dataset.act === 'edit') {
        current = JSON.parse(JSON.stringify(inv));
        activeTab = 'editor';
        root.querySelectorAll('.inv-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'editor'));
        renderTab();
      } else if (b.dataset.act === 'pdf') {
        generatePDF(inv);
        analytics.trackToolDownload(toolId);
      } else if (b.dataset.act === 'dup') {
        const copy = JSON.parse(JSON.stringify(inv));
        copy.id = newId();
        copy.meta.number = nextInvoiceNumber(invoices);
        copy.meta.issueDate = todayISO();
        copy.meta.dueDate = addDaysISO(copy.meta.issueDate, 30);
        copy.meta.status = 'draft';
        copy.createdAt = Date.now();
        copy.updatedAt = Date.now();
        invoices.unshift(copy);
        saveInvoices(invoices);
        renderStats();
        renderTab();
        toast('Duplicated', 'success');
      } else if (b.dataset.act === 'del') {
        if (!confirm('Delete this invoice permanently?')) return;
        invoices = invoices.filter((x) => x.id !== inv.id);
        saveInvoices(invoices);
        renderStats();
        renderTab();
        toast('Deleted');
      }
    }));
  }

  /* ----------------------------------------------------------
     REPORTS TAB
     ---------------------------------------------------------- */
  function renderReports(panel) {
    if (!invoices.length) {
      panel.innerHTML = `<div class="empty-state"><p>No data yet. Save some invoices to see reports.</p></div>`;
      return;
    }
    const cur = invoices[0].meta.currency;

    const byStatus = STATUSES.map((s) => ({
      status: s,
      count: invoices.filter((i) => i.meta.status === s).length,
      total: invoices.filter((i) => i.meta.status === s).reduce((sum, i) => sum + computeTotals(i).total, 0),
    }));

    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const label = d.toLocaleDateString(undefined, { month: 'short' });
      const total = invoices
        .filter((inv) => inv.meta.issueDate.startsWith(key))
        .reduce((s, inv) => s + computeTotals(inv).total, 0);
      months.push({ key, label, total });
    }
    const maxMonth = Math.max(1, ...months.map((m) => m.total));

    const clientMap = {};
    invoices.forEach((inv) => {
      const name = inv.client.name || '(no client)';
      if (!clientMap[name]) clientMap[name] = { name, count: 0, total: 0 };
      clientMap[name].count++;
      clientMap[name].total += computeTotals(inv).total;
    });
    const topClients = Object.values(clientMap).sort((a, b) => b.total - a.total).slice(0, 5);

    panel.innerHTML = `
      <div class="inv-reports">
        <section class="inv-section">
          <h3 class="inv-section-title">Revenue by month (last 12 months)</h3>
          <div class="inv-spark">
            ${months.map((m) => `
              <div class="inv-spark-col" title="${m.key}: ${formatMoney(m.total, cur)}">
                <div class="inv-spark-bar" style="height:${(m.total / maxMonth) * 100}%"></div>
                <span class="inv-spark-label">${m.label}</span>
              </div>`).join('')}
          </div>
        </section>

        <section class="inv-section">
          <h3 class="inv-section-title">Invoices by status</h3>
          <table class="data-table">
            <thead><tr><th>Status</th><th class="num">Count</th><th class="num">Total</th></tr></thead>
            <tbody>
              ${byStatus.map((r) => `
                <tr>
                  <td><span class="inv-status inv-status-${r.status}">${r.status}</span></td>
                  <td class="num">${r.count}</td>
                  <td class="num">${formatMoney(r.total, cur)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </section>

        <section class="inv-section">
          <h3 class="inv-section-title">Top clients</h3>
          ${topClients.length
            ? `<table class="data-table">
                <thead><tr><th>Client</th><th class="num">Invoices</th><th class="num">Total billed</th></tr></thead>
                <tbody>
                  ${topClients.map((c) => `<tr><td>${escapeHTML(c.name)}</td><td class="num">${c.count}</td><td class="num">${formatMoney(c.total, cur)}</td></tr>`).join('')}
                </tbody>
              </table>`
            : '<p class="muted" style="padding:18px">No client data yet.</p>'}
        </section>
      </div>`;
  }

  /* ============================================================
     PDF GENERATION
     ============================================================ */
  async function generatePDF(inv) {
    const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const M = 40;
    const cur = inv.meta.currency || 'USD';
    const t = computeTotals(inv);

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pw, 6, 'F');

    let y = M;

    // Logo
    if (inv.business.logoDataUrl) {
      try {
        const fmt = inv.business.logoDataUrl.includes('png') ? 'PNG' : 'JPEG';
        const img = doc.getImageProperties(inv.business.logoDataUrl);
        const maxW = 110, maxH = 60;
        const r = Math.min(maxW / img.width, maxH / img.height);
        doc.addImage(inv.business.logoDataUrl, fmt, M, y, img.width * r, img.height * r);
      } catch (e) { /* skip */ }
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    doc.setTextColor(15, 23, 42);
    doc.text('INVOICE', pw - M, y + 20, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text('#' + inv.meta.number, pw - M, y + 38, { align: 'right' });
    y += 70;

    // From / Bill To
    const colW = (pw - M * 2 - 20) / 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text('FROM', M, y);
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(inv.business.name || '', M, y + 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(60);
    let by = y + 28;
    const bizLines = [];
    if (inv.business.address) bizLines.push(...inv.business.address.split('\n'));
    if (inv.business.email) bizLines.push(inv.business.email);
    if (inv.business.phone) bizLines.push(inv.business.phone);
    if (inv.business.website) bizLines.push(inv.business.website);
    if (inv.business.taxId) bizLines.push('Tax ID: ' + inv.business.taxId);
    bizLines.forEach((l) => { doc.text(l, M, by); by += 13; });

    const rx = M + colW + 20;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text('BILL TO', rx, y);
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(inv.client.name || '', rx, y + 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(60);
    let cy = y + 28;
    const cliLines = [];
    if (inv.client.address) cliLines.push(...inv.client.address.split('\n'));
    if (inv.client.email) cliLines.push(inv.client.email);
    if (inv.client.phone) cliLines.push(inv.client.phone);
    cliLines.forEach((l) => { doc.text(l, rx, cy); cy += 13; });

    y = Math.max(by, cy) + 10;

    // Meta strip
    doc.setFillColor(248, 250, 252);
    doc.rect(M, y, pw - M * 2, 34, 'F');
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text('ISSUE DATE', M + 10, y + 14);
    doc.text('DUE DATE', M + 130, y + 14);
    doc.text('STATUS', M + 250, y + 14);
    if (inv.meta.poNumber) doc.text('PO NUMBER', M + 360, y + 14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(fmtDate(inv.meta.issueDate), M + 10, y + 26);
    doc.text(fmtDate(inv.meta.dueDate), M + 130, y + 26);
    doc.text(inv.meta.status.toUpperCase(), M + 250, y + 26);
    if (inv.meta.poNumber) doc.text(inv.meta.poNumber, M + 360, y + 26);

    y += 34 + 20;

    // Items table
    const cols = { desc: M, qty: pw - M - 260, price: pw - M - 180, tax: pw - M - 90, total: pw - M };
    doc.setFillColor(15, 23, 42);
    doc.rect(M, y, pw - M * 2, 22, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255);
    doc.text('DESCRIPTION', cols.desc + 8, y + 14);
    doc.text('QTY', cols.qty, y + 14, { align: 'right' });
    doc.text('UNIT PRICE', cols.price, y + 14, { align: 'right' });
    doc.text('TAX', cols.tax, y + 14, { align: 'right' });
    doc.text('LINE TOTAL', cols.total - 8, y + 14, { align: 'right' });
    y += 22;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    let alt = false;
    inv.items.forEach((it) => {
      const lineTotal = (it.quantity || 0) * (it.unitPrice || 0);
      const descLines = doc.splitTextToSize(it.description || '', cols.qty - cols.desc - 20);
      const rowH = Math.max(20, descLines.length * 13 + 8);
      if (alt) { doc.setFillColor(250, 250, 251); doc.rect(M, y, pw - M * 2, rowH, 'F'); }
      alt = !alt;
      doc.setTextColor(15, 23, 42);
      doc.text(descLines, cols.desc + 8, y + 14);
      doc.setTextColor(60);
      doc.text(String(it.quantity), cols.qty, y + 14, { align: 'right' });
      doc.text(formatMoney(it.unitPrice, cur), cols.price, y + 14, { align: 'right' });
      doc.text((it.taxRate || 0) + '%', cols.tax, y + 14, { align: 'right' });
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.text(formatMoney(lineTotal, cur), cols.total - 8, y + 14, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      y += rowH;
    });

    doc.setDrawColor(220, 220, 225);
    doc.line(M, y, pw - M, y);
    y += 20;

    // Totals
    const totalX = pw - M;
    const labelX = pw - M - 120;
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text('Subtotal', labelX, y, { align: 'right' });
    doc.setTextColor(15, 23, 42);
    doc.text(formatMoney(t.subtotal, cur), totalX, y, { align: 'right' });
    y += 16;
    if (t.discount > 0) {
      doc.setTextColor(100);
      doc.text('Discount', labelX, y, { align: 'right' });
      doc.setTextColor(15, 23, 42);
      doc.text('-' + formatMoney(t.discount, cur), totalX, y, { align: 'right' });
      y += 16;
    }
    if (t.taxTotal > 0) {
      doc.setTextColor(100);
      doc.text('Tax', labelX, y, { align: 'right' });
      doc.setTextColor(15, 23, 42);
      doc.text(formatMoney(t.taxTotal, cur), totalX, y, { align: 'right' });
      y += 16;
    }
    if (t.shipping > 0) {
      doc.setTextColor(100);
      doc.text('Shipping', labelX, y, { align: 'right' });
      doc.setTextColor(15, 23, 42);
      doc.text(formatMoney(t.shipping, cur), totalX, y, { align: 'right' });
      y += 16;
    }
    y += 4;
    doc.setFillColor(15, 23, 42);
    doc.rect(labelX - 40, y, pw - M - labelX + 40, 30, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('TOTAL DUE', labelX - 20, y + 20);
    doc.setFontSize(14);
    doc.text(formatMoney(t.total, cur), totalX - 8, y + 20, { align: 'right' });
    y += 44;

    // Notes
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120);
    if (inv.notes.paymentTerms) {
      doc.text('PAYMENT TERMS', M, y); y += 12;
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(10);
      doc.text(inv.notes.paymentTerms, M, y); y += 18;
      doc.setFontSize(9);
      doc.setTextColor(120);
    }
    if (inv.notes.paymentDetails) {
      doc.text('PAYMENT DETAILS', M, y); y += 12;
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(inv.notes.paymentDetails, pw - M * 2);
      lines.forEach((l) => { doc.text(l, M, y); y += 13; });
      y += 6;
      doc.setFontSize(9);
      doc.setTextColor(120);
    }
    if (inv.notes.notes) {
      doc.text('NOTES', M, y); y += 12;
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(inv.notes.notes, pw - M * 2);
      lines.forEach((l) => { doc.text(l, M, y); y += 13; });
      y += 10;
    }

    // Signature
    if (inv.signature.dataUrl) {
      try {
        const img = doc.getImageProperties(inv.signature.dataUrl);
        const sigW = 160;
        const sigH = img.height * (sigW / img.width);
        const sx = pw - M - sigW;
        const sy = ph - M - 60 - sigH;
        doc.addImage(inv.signature.dataUrl, 'PNG', sx, sy, sigW, sigH);
        doc.setDrawColor(180);
        doc.line(sx, ph - M - 52, sx + sigW, ph - M - 52);
        doc.setFontSize(9);
        doc.setTextColor(120);
        doc.text(inv.signature.label || 'Authorized Signature', sx + sigW / 2, ph - M - 38, { align: 'center' });
        if (inv.signature.showName) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(15, 23, 42);
          doc.setFontSize(10);
          doc.text(inv.signature.showName, sx + sigW / 2, ph - M - 24, { align: 'center' });
        }
      } catch (e) { /* skip */ }
    }

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150);
    const footer = [inv.business.name, inv.business.email, inv.business.phone].filter(Boolean).join('  •  ');
    if (footer) doc.text(footer, pw / 2, ph - 16, { align: 'center' });

    const safeClient = (inv.client.name || 'invoice').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    doc.save(`${inv.meta.number}_${safeClient}.pdf`);
    analytics.trackToolComplete(toolId);
  }
}

export const BUSINESS_TOOLS = {
  'invoice': { name: 'Invoice Generator', render: renderInvoice },
};