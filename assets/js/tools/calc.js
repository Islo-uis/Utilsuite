import { analytics } from '../analytics.js';
import { $, icon, toast, download } from '../utils.js';

const fmtMoney = (n, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n);

/* ---------- Percentage Calculator ---------- */
function renderPercentage(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="tool-row">
      <div class="field-row"><label>Value A</label><input type="number" id="pcA" value="10"/></div>
      <div class="field-row"><label>Value B</label><input type="number" id="pcB" value="200"/></div>
    </div>
    <div class="result-display" id="pcOut">Pick an operation below</div>
    <div class="field-group" style="margin-top:20px">
      <button class="btn btn-outline btn-sm" data-op="pctOf">A% of B</button>
      <button class="btn btn-outline btn-sm" data-op="whatPct">A is what % of B</button>
      <button class="btn btn-outline btn-sm" data-op="pctChange">% change A→B</button>
      <button class="btn btn-outline btn-sm" data-op="addPct">B + A%</button>
      <button class="btn btn-outline btn-sm" data-op="subPct">B − A%</button>
    </div>
  </div>`;
  root.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => {
    const a = +root.querySelector('#pcA').value, b = +root.querySelector('#pcB').value;
    let r, label;
    if (b.dataset.op === 'pctOf') { r = (a / 100) * b; label = `${a}% of ${b}`; }
    if (b.dataset.op === 'whatPct') { r = ((a / b) * 100).toFixed(2) + '%'; label = `${a} is what % of ${b}`; }
    if (b.dataset.op === 'pctChange') { r = (((b - a) / a) * 100).toFixed(2) + '%'; label = `Change from ${a} to ${b}`; }
    if (b.dataset.op === 'addPct') { r = b * (1 + a / 100); label = `${b} + ${a}%`; }
    if (b.dataset.op === 'subPct') { r = b * (1 - a / 100); label = `${b} − ${a}%`; }
    root.querySelector('#pcOut').innerHTML = `<div style="font-size:13px;opacity:0.7;font-weight:500">${label}</div>${typeof r === 'number' ? r.toLocaleString(undefined, { maximumFractionDigits: 4 }) : r}`;
    analytics.trackToolComplete(toolId);
  }));
}

/* ---------- Discount Calculator ---------- */
function renderDiscount(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="tool-row">
      <div class="field-row"><label>Original price</label><input type="number" id="dcPrice" value="99.99" step="0.01"/></div>
      <div class="field-row"><label>Discount %</label><input type="number" id="dcPct" value="20" step="0.1"/></div>
      <div class="field-row"><label>Tax % (optional)</label><input type="number" id="dcTax" value="0" step="0.1"/></div>
    </div>
    <div class="stat-list" id="dcOut" style="margin-top:20px"></div>
  </div>`;
  const update = () => {
    const p = +root.querySelector('#dcPrice').value;
    const d = +root.querySelector('#dcPct').value;
    const t = +root.querySelector('#dcTax').value;
    const save = p * (d / 100);
    const after = p - save;
    const tax = after * (t / 100);
    const final = after + tax;
    root.querySelector('#dcOut').innerHTML = [
      ['You save', fmtMoney(save)],
      ['After discount', fmtMoney(after)],
      ['Tax', fmtMoney(tax)],
      ['Final price', fmtMoney(final)],
    ].map(([l, v]) => `<div class="stat-item"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
    analytics.trackToolComplete(toolId);
  };
  ['#dcPrice', '#dcPct', '#dcTax'].forEach((s) => root.querySelector(s).addEventListener('input', update));
  update();
}

/* ---------- VAT / Tax Calculator ---------- */
function renderVat(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="tool-row">
      <div class="field-row"><label>Amount</label><input type="number" id="vtAmt" value="100" step="0.01"/></div>
      <div class="field-row"><label>VAT / Tax %</label><input type="number" id="vtRate" value="20" step="0.1"/></div>
      <div class="field-row"><label>Amount is</label><select id="vtMode"><option value="net">Net (excl. tax)</option><option value="gross">Gross (incl. tax)</option></select></div>
    </div>
    <div class="stat-list" id="vtOut" style="margin-top:20px"></div>
  </div>`;
  const update = () => {
    const a = +root.querySelector('#vtAmt').value;
    const r = +root.querySelector('#vtRate').value;
    const mode = root.querySelector('#vtMode').value;
    let net, tax, gross;
    if (mode === 'net') { net = a; tax = a * r / 100; gross = a + tax; }
    else { gross = a; net = a / (1 + r / 100); tax = gross - net; }
    root.querySelector('#vtOut').innerHTML = [
      ['Net', fmtMoney(net)], ['VAT/Tax', fmtMoney(tax)], ['Gross', fmtMoney(gross)],
    ].map(([l, v]) => `<div class="stat-item"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
    analytics.trackToolComplete(toolId);
  };
  ['#vtAmt', '#vtRate', '#vtMode'].forEach((s) => root.querySelector(s).addEventListener('input', update));
  update();
}

/* ---------- Loan Calculator ---------- */
function renderLoan(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="tool-row">
      <div class="field-row"><label>Loan amount</label><input type="number" id="lnAmt" value="20000" step="100"/></div>
      <div class="field-row"><label>Annual interest rate %</label><input type="number" id="lnRate" value="6.5" step="0.1"/></div>
      <div class="field-row"><label>Term (years)</label><input type="number" id="lnYears" value="5" step="0.5"/></div>
    </div>
    <div class="stat-list" id="lnOut" style="margin-top:20px"></div>
    <div class="field-row" style="margin-top:20px"><label>Amortization preview (first 12 months)</label></div>
    <div class="card-panel" style="overflow-x:auto"><table class="data-table" id="lnTable"></table></div>
  </div>`;
  const update = () => {
    const P = +root.querySelector('#lnAmt').value;
    const r = +root.querySelector('#lnRate').value / 100 / 12;
    const n = Math.round(+root.querySelector('#lnYears').value * 12);
    const M = r ? P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : P / n;
    const total = M * n;
    const interest = total - P;
    root.querySelector('#lnOut').innerHTML = [
      ['Monthly payment', fmtMoney(M)],
      ['Total paid', fmtMoney(total)],
      ['Total interest', fmtMoney(interest)],
      ['Payments', n + ' months'],
    ].map(([l, v]) => `<div class="stat-item"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
    let bal = P;
    const rows = [];
    for (let i = 1; i <= Math.min(n, 12); i++) {
      const int = bal * r;
      const prin = M - int;
      bal -= prin;
      rows.push(`<tr><td>${i}</td><td>${fmtMoney(int)}</td><td>${fmtMoney(prin)}</td><td>${fmtMoney(Math.max(0, bal))}</td></tr>`);
    }
    root.querySelector('#lnTable').innerHTML = `<thead><tr><th>#</th><th>Interest</th><th>Principal</th><th>Balance</th></tr></thead><tbody>${rows.join('')}</tbody>`;
    analytics.trackToolComplete(toolId);
  };
  ['#lnAmt', '#lnRate', '#lnYears'].forEach((s) => root.querySelector(s).addEventListener('input', update));
  update();
}

/* ---------- Salary / Hourly Rate ---------- */
function renderSalary(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="tool-row">
      <div class="field-row"><label>Amount</label><input type="number" id="slAmt" value="25" step="0.01"/></div>
      <div class="field-row"><label>Per</label><select id="slPer"><option value="hour">Hour</option><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option></select></div>
      <div class="field-row"><label>Hours per week</label><input type="number" id="slHpw" value="40" min="1"/></div>
      <div class="field-row"><label>Weeks per year</label><input type="number" id="slWpy" value="52" min="1"/></div>
    </div>
    <div class="stat-list" id="slOut" style="margin-top:20px"></div>
  </div>`;
  const update = () => {
    const a = +root.querySelector('#slAmt').value;
    const per = root.querySelector('#slPer').value;
    const hpw = +root.querySelector('#slHpw').value;
    const wpy = +root.querySelector('#slWpy').value;
    const hoursPerYear = hpw * wpy;
    let hourly;
    if (per === 'hour') hourly = a;
    if (per === 'day') hourly = a / (hpw / 5);
    if (per === 'week') hourly = a / hpw;
    if (per === 'month') hourly = a * 12 / hoursPerYear;
    if (per === 'year') hourly = a / hoursPerYear;
    const daily = hourly * (hpw / 5);
    const weekly = hourly * hpw;
    const monthly = weekly * wpy / 12;
    const yearly = weekly * wpy;
    root.querySelector('#slOut').innerHTML = [
      ['Hourly', fmtMoney(hourly)], ['Daily', fmtMoney(daily)], ['Weekly', fmtMoney(weekly)],
      ['Monthly', fmtMoney(monthly)], ['Yearly', fmtMoney(yearly)],
    ].map(([l, v]) => `<div class="stat-item"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
    analytics.trackToolComplete(toolId);
  };
  ['#slAmt', '#slPer', '#slHpw', '#slWpy'].forEach((s) => root.querySelector(s).addEventListener('input', update));
  update();
}

/* ---------- Unit Converter ---------- */
const UNITS = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.34, yd: 0.9144, ft: 0.3048, in: 0.0254 },
  weight: { kg: 1, g: 0.001, mg: 0.000001, lb: 0.453592, oz: 0.0283495, t: 1000 },
  area:   { 'm²': 1, 'km²': 1e6, 'cm²': 0.0001, 'ha': 10000, 'ac': 4046.86, 'ft²': 0.092903, 'mi²': 2.59e6 },
  volume: { 'L': 1, 'mL': 0.001, 'm³': 1000, 'gal (US)': 3.78541, 'qt': 0.946353, 'pt': 0.473176, 'cup': 0.236588, 'fl oz': 0.0295735 },
  speed:  { 'm/s': 1, 'km/h': 0.277778, 'mph': 0.44704, 'knot': 0.514444, 'ft/s': 0.3048 },
  data:   { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4, bit: 1 / 8, Kbit: 128, Mbit: 131072, Gbit: 134217728 },
};

function renderUnitConverter(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="tool-row">
      <div class="field-row"><label>Category</label>
        <select id="ucCat"><option value="length">Length</option><option value="weight">Weight</option><option value="area">Area</option><option value="volume">Volume</option><option value="speed">Speed</option><option value="data">Digital storage</option></select>
      </div>
    </div>
    <div class="tool-row">
      <div class="field-row"><label>From</label><input type="number" id="ucVal" value="1" step="any"/></div>
      <div class="field-row"><label>From unit</label><select id="ucFrom"></select></div>
      <div class="field-row"><label>To unit</label><select id="ucTo"></select></div>
    </div>
    <div class="result-display" id="ucOut">—</div>
  </div>`;

  const convert = () => {
    const cat = root.querySelector('#ucCat').value;
    const v = +root.querySelector('#ucVal').value;
    const f = root.querySelector('#ucFrom').value;
    const t = root.querySelector('#ucTo').value;
    const r = v * UNITS[cat][f] / UNITS[cat][t];
    root.querySelector('#ucOut').textContent = `${v} ${f} = ${r.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${t}`;
    analytics.trackToolComplete(toolId);
  };

  const renderUnits = () => {
    const cat = root.querySelector('#ucCat').value;
    const units = Object.keys(UNITS[cat]);
    const opts = units.map((u) => `<option value="${u}">${u}</option>`).join('');
    root.querySelector('#ucFrom').innerHTML = opts;
    root.querySelector('#ucTo').innerHTML = opts;
    root.querySelector('#ucTo').value = units[1];
    convert();
  };

  root.querySelector('#ucCat').addEventListener('change', renderUnits);
  ['#ucVal', '#ucFrom', '#ucTo'].forEach((s) => root.querySelector(s).addEventListener('input', convert));
  renderUnits();
}

/* ---------- Age Calculator ---------- */
function renderAge(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="tool-row">
      <div class="field-row"><label>Date of birth</label><input type="date" id="agDob"/></div>
      <div class="field-row"><label>Age at date</label><input type="date" id="agAsOf"/></div>
    </div>
    <div class="stat-list" id="agOut" style="margin-top:20px"></div>
  </div>`;
  const today = new Date().toISOString().slice(0, 10);
  root.querySelector('#agDob').value = '2000-01-01';
  root.querySelector('#agAsOf').value = today;
  const update = () => {
    const dob = new Date(root.querySelector('#agDob').value);
    const asOf = new Date(root.querySelector('#agAsOf').value);
    if (isNaN(dob) || isNaN(asOf) || dob > asOf) return;
    let years = asOf.getFullYear() - dob.getFullYear();
    let months = asOf.getMonth() - dob.getMonth();
    let days = asOf.getDate() - dob.getDate();
    if (days < 0) { months--; days += new Date(asOf.getFullYear(), asOf.getMonth(), 0).getDate(); }
    if (months < 0) { years--; months += 12; }
    const totalDays = Math.floor((asOf - dob) / 86400000);
    root.querySelector('#agOut').innerHTML = [
      ['Age', `${years} years`], ['Months beyond years', months], ['Days beyond months', days],
      ['Total days', totalDays.toLocaleString()], ['Total weeks', Math.floor(totalDays / 7).toLocaleString()],
      ['Total hours', (totalDays * 24).toLocaleString()],
    ].map(([l, v]) => `<div class="stat-item"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
    analytics.trackToolComplete(toolId);
  };
  ['#agDob', '#agAsOf'].forEach((s) => root.querySelector(s).addEventListener('input', update));
  update();
}

/* ---------- Date Difference ---------- */
function renderDateDiff(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="tool-row">
      <div class="field-row"><label>Start date</label><input type="date" id="ddA"/></div>
      <div class="field-row"><label>End date</label><input type="date" id="ddB"/></div>
    </div>
    <div class="stat-list" id="ddOut" style="margin-top:20px"></div>
  </div>`;
  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  root.querySelector('#ddA').value = today;
  root.querySelector('#ddB').value = nextWeek;
  const update = () => {
    const a = new Date(root.querySelector('#ddA').value);
    const b = new Date(root.querySelector('#ddB').value);
    if (isNaN(a) || isNaN(b)) return;
    const days = Math.round((b - a) / 86400000);
    const weeks = days / 7;
    const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    const years = days / 365.25;
    const weekdays = (() => {
      const sign = days < 0 ? -1 : 1;
      const [start, end] = sign > 0 ? [a, b] : [b, a];
      let count = 0;
      const cur = new Date(start);
      while (cur <= end) { const d = cur.getDay(); if (d !== 0 && d !== 6) count++; cur.setDate(cur.getDate() + 1); }
      return count * sign;
    })();
    root.querySelector('#ddOut').innerHTML = [
      ['Days', days.toLocaleString()],
      ['Weekdays', weekdays.toLocaleString()],
      ['Weeks', weeks.toFixed(2)],
      ['Months (approx.)', months],
      ['Years (approx.)', years.toFixed(2)],
      ['Hours', (days * 24).toLocaleString()],
    ].map(([l, v]) => `<div class="stat-item"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
    analytics.trackToolComplete(toolId);
  };
  ['#ddA', '#ddB'].forEach((s) => root.querySelector(s).addEventListener('input', update));
  update();
}

/* ---------- Time Zone Converter ---------- */
function renderTimeZone(root, toolId) {
  const zones = [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
    'Africa/Cairo', 'Africa/Lagos', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata',
    'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Manila', 'Australia/Sydney',
    'Pacific/Auckland',
  ];
  root.innerHTML = `<div class="panel">
    <div class="tool-row">
      <div class="field-row"><label>Date</label><input type="date" id="tzDate"/></div>
      <div class="field-row"><label>Time</label><input type="time" id="tzTime" value="12:00"/></div>
      <div class="field-row"><label>From timezone</label><select id="tzFrom">${zones.map((z) => `<option>${z}</option>`).join('')}</select></div>
    </div>
    <div class="field-row" style="margin-top:20px"><label>Same moment in other timezones</label></div>
    <div class="card-panel" style="overflow-x:auto"><table class="data-table" id="tzOut"></table></div>
  </div>`;
  root.querySelector('#tzDate').value = new Date().toISOString().slice(0, 10);
  root.querySelector('#tzFrom').value = 'UTC';

  const getOffset = (date, tz) => {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
    const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
    return (asUTC - date.getTime()) / 60000;
  };

  const update = () => {
    const d = root.querySelector('#tzDate').value;
    const t = root.querySelector('#tzTime').value || '12:00';
    const from = root.querySelector('#tzFrom').value;
    const [y, mo, da] = d.split('-').map(Number);
    const [hh, mm] = t.split(':').map(Number);
    const utcGuess = new Date(Date.UTC(y, mo - 1, da, hh, mm));
    const fromOffset = getOffset(utcGuess, from);
    const utcTime = new Date(utcGuess.getTime() - fromOffset * 60000);
    const rows = zones.map((z) => {
      const off = getOffset(utcTime, z);
      const local = new Date(utcTime.getTime() + off * 60000);
      const str = local.toLocaleString(undefined, { hour12: false, weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const diff = (off / 60).toFixed(1);
      return `<tr><td>${z}</td><td>${str}</td><td class="num">${diff >= 0 ? '+' : ''}${diff}h</td></tr>`;
    });
    root.querySelector('#tzOut').innerHTML = `<thead><tr><th>Timezone</th><th>Local time</th><th>Offset</th></tr></thead><tbody>${rows.join('')}</tbody>`;
    analytics.trackToolComplete(toolId);
  };
  ['#tzDate', '#tzTime', '#tzFrom'].forEach((s) => root.querySelector(s).addEventListener('input', update));
  update();
}

/* ---------- Invoice / Receipt Generator ---------- */
function renderInvoice(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="tool-row">
      <div class="field-row"><label>Business name</label><input type="text" id="invFrom" value="Your Business"/></div>
      <div class="field-row"><label>Client name</label><input type="text" id="invTo" value="Client Name"/></div>
      <div class="field-row"><label>Invoice #</label><input type="text" id="invNo" value="INV-001"/></div>
      <div class="field-row"><label>Date</label><input type="date" id="invDate"/></div>
    </div>
    <div class="field-row" style="margin-top:16px"><label>Line items</label></div>
    <div id="invItems"></div>
    <div class="actions">
      <button id="invAdd" class="btn btn-outline btn-sm">+ Add line</button>
      <button id="invPdf" class="btn btn-primary">${icon('download', 16)} Download PDF</button>
    </div>
    <div class="field-group" style="margin-top:12px">
      <div class="field"><label>Tax %</label><input type="number" id="invTax" value="0" step="0.1"/></div>
    </div>
  </div>`;
  root.querySelector('#invDate').value = new Date().toISOString().slice(0, 10);
  const items = [{ desc: 'Service', qty: 1, price: 100 }];

  const renderItems = () => {
    root.querySelector('#invItems').innerHTML = items.map((it, i) => `
      <div class="tool-row" style="grid-template-columns:2fr 1fr 1fr auto;align-items:end;margin-bottom:8px">
        <input type="text" value="${String(it.desc).replace(/"/g, '&quot;')}" data-i="${i}" data-f="desc" placeholder="Description"/>
        <input type="number" value="${it.qty}" data-i="${i}" data-f="qty" min="0" step="any"/>
        <input type="number" value="${it.price}" data-i="${i}" data-f="price" min="0" step="0.01"/>
        <button class="btn btn-outline btn-sm" data-del="${i}">${icon('x', 12)}</button>
      </div>`).join('');
    root.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('input', (e) => {
      const i = +e.target.dataset.i;
      items[i][e.target.dataset.f] = e.target.dataset.f === 'desc' ? e.target.value : +e.target.value;
    }));
    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { items.splice(+b.dataset.del, 1); renderItems(); }));
  };
  renderItems();
  root.querySelector('#invAdd').addEventListener('click', () => { items.push({ desc: '', qty: 1, price: 0 }); renderItems(); });

  root.querySelector('#invPdf').addEventListener('click', async () => {
    const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 50, pw = doc.internal.pageSize.getWidth();
    let y = margin;
    doc.setFontSize(22); doc.setFont(undefined, 'bold');
    doc.text('INVOICE', pw - margin, y, { align: 'right' });
    doc.setFontSize(12); doc.setFont(undefined, 'normal');
    y += 10;
    doc.text(root.querySelector('#invFrom').value, margin, y + 12);
    y += 30;
    doc.setFontSize(10); doc.setTextColor(120);
    doc.text('Bill to', margin, y); y += 14;
    doc.setTextColor(0);
    doc.text(root.querySelector('#invTo').value, margin, y); y += 24;
    doc.setTextColor(120);
    doc.text('Invoice #: ' + root.querySelector('#invNo').value, pw - margin, y, { align: 'right' });
    doc.text('Date: ' + root.querySelector('#invDate').value, pw - margin, y + 14, { align: 'right' });
    doc.setTextColor(0);
    y += 40;
    doc.setFont(undefined, 'bold');
    doc.text('Description', margin, y);
    doc.text('Qty', pw - margin - 180, y, { align: 'right' });
    doc.text('Price', pw - margin - 100, y, { align: 'right' });
    doc.text('Total', pw - margin, y, { align: 'right' });
    doc.setFont(undefined, 'normal');
    y += 8;
    doc.line(margin, y, pw - margin, y); y += 16;
    let subtotal = 0;
    items.forEach((it) => {
      const total = it.qty * it.price;
      subtotal += total;
      doc.text(String(it.desc).slice(0, 40), margin, y);
      doc.text(String(it.qty), pw - margin - 180, y, { align: 'right' });
      doc.text('$' + it.price.toFixed(2), pw - margin - 100, y, { align: 'right' });
      doc.text('$' + total.toFixed(2), pw - margin, y, { align: 'right' });
      y += 18;
    });
    y += 10;
    doc.line(pw - margin - 220, y, pw - margin, y); y += 18;
    const taxPct = +root.querySelector('#invTax').value || 0;
    const tax = subtotal * taxPct / 100;
    doc.text('Subtotal', pw - margin - 100, y, { align: 'right' });
    doc.text('$' + subtotal.toFixed(2), pw - margin, y, { align: 'right' }); y += 18;
    if (taxPct) {
      doc.text(`Tax (${taxPct}%)`, pw - margin - 100, y, { align: 'right' });
      doc.text('$' + tax.toFixed(2), pw - margin, y, { align: 'right' }); y += 18;
    }
    doc.setFont(undefined, 'bold'); doc.setFontSize(14);
    doc.text('Total', pw - margin - 100, y, { align: 'right' });
    doc.text('$' + (subtotal + tax).toFixed(2), pw - margin, y, { align: 'right' });
    doc.save('invoice.pdf');
    analytics.trackToolComplete(toolId); analytics.trackToolDownload(toolId);
    toast('Invoice PDF saved', 'success');
  });
}

export const CALC_TOOLS = {
  'percentage':  { name: 'Percentage',        render: renderPercentage },
  'discount':    { name: 'Discount',          render: renderDiscount },
  'vat':         { name: 'VAT / Tax',         render: renderVat },
  'loan':        { name: 'Loan',              render: renderLoan },
  'salary':      { name: 'Salary / Hourly',   render: renderSalary },
  'unit-conv':   { name: 'Unit Converter',    render: renderUnitConverter },
  'age':         { name: 'Age',               render: renderAge },
  'date-diff':   { name: 'Date Difference',   render: renderDateDiff },
  'timezone':    { name: 'Time Zone',         render: renderTimeZone },
  'invoice':     { name: 'Invoice / Receipt', render: renderInvoice },
};