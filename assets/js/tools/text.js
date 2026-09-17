import { analytics } from '../analytics.js';
import { $, icon, toast, download, escapeHTML } from '../utils.js';

function renderWordCount(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="field-row"><label>Text</label><textarea id="wcIn" placeholder="Paste or type your text…"></textarea></div>
    <div class="stat-list" id="wcStats" style="margin-top:16px"></div>
  </div>`;
  const update = () => {
    const t = root.querySelector('#wcIn').value;
    const words = t.trim() ? t.trim().split(/\s+/).length : 0;
    const chars = t.length;
    const charsNoSpaces = t.replace(/\s/g, '').length;
    const sentences = (t.match(/[.!?]+(\s|$)/g) || []).length;
    const paragraphs = t.trim() ? t.trim().split(/\n\s*\n/).filter(Boolean).length : 0;
    const readingTime = Math.max(1, Math.ceil(words / 200));
    root.querySelector('#wcStats').innerHTML = [
      ['Words', words], ['Characters', chars], ['No spaces', charsNoSpaces],
      ['Sentences', sentences], ['Paragraphs', paragraphs], ['Read time', readingTime + ' min'],
    ].map(([l, v]) => `<div class="stat-item"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
    analytics.trackToolComplete(toolId);
  };
  root.querySelector('#wcIn').addEventListener('input', update);
  update();
}

function renderCaseConverter(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="field-row"><label>Text</label><textarea id="ccIn" placeholder="Paste text…"></textarea></div>
    <div class="field-group">
      <button class="btn btn-outline btn-sm" data-case="upper">UPPERCASE</button>
      <button class="btn btn-outline btn-sm" data-case="lower">lowercase</button>
      <button class="btn btn-outline btn-sm" data-case="title">Title Case</button>
      <button class="btn btn-outline btn-sm" data-case="sentence">Sentence case</button>
      <button class="btn btn-outline btn-sm" data-case="camel">camelCase</button>
      <button class="btn btn-outline btn-sm" data-case="snake">snake_case</button>
      <button class="btn btn-outline btn-sm" data-case="kebab">kebab-case</button>
    </div>
    <div class="actions">
      <button id="ccCopy" class="btn btn-primary">Copy result</button>
      <button id="ccReplace" class="btn btn-outline">Replace input</button>
    </div>
  </div>`;
  root.querySelectorAll('[data-case]').forEach((b) => b.addEventListener('click', () => {
    const t = root.querySelector('#ccIn').value;
    const c = b.dataset.case;
    let out = t;
    if (c === 'upper') out = t.toUpperCase();
    else if (c === 'lower') out = t.toLowerCase();
    else if (c === 'title') out = t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    else if (c === 'sentence') out = t.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (m) => m.toUpperCase());
    else if (c === 'camel') out = t.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, ch) => ch.toUpperCase()).replace(/^[A-Z]/, (c) => c.toLowerCase());
    else if (c === 'snake') out = t.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    else if (c === 'kebab') out = t.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    root.querySelector('#ccIn').value = out;
    analytics.trackToolComplete(toolId);
  }));
  root.querySelector('#ccCopy').addEventListener('click', () => { navigator.clipboard.writeText(root.querySelector('#ccIn').value); toast('Copied'); });
  root.querySelector('#ccReplace').addEventListener('click', () => toast('Result is already in the input'));
}

function renderTextCleaner(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="field-row"><label>Text</label><textarea id="tcIn" placeholder="Paste text…"></textarea></div>
    <div class="field-group">
      <button class="btn btn-outline btn-sm" data-op="dedupe">Remove duplicate lines</button>
      <button class="btn btn-outline btn-sm" data-op="spaces">Remove extra spaces</button>
      <button class="btn btn-outline btn-sm" data-op="blank">Remove blank lines</button>
      <button class="btn btn-outline btn-sm" data-op="trim">Trim each line</button>
      <button class="btn btn-outline btn-sm" data-op="sort">Sort lines A→Z</button>
      <button class="btn btn-outline btn-sm" data-op="rsort">Sort lines Z→A</button>
      <button class="btn btn-outline btn-sm" data-op="reverse">Reverse line order</button>
      <button class="btn btn-outline btn-sm" data-op="number">Number lines</button>
    </div>
    <div class="actions"><button id="tcCopy" class="btn btn-primary">Copy result</button></div>
  </div>`;
  root.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => {
    const lines = root.querySelector('#tcIn').value.split(/\r?\n/);
    let out = lines;
    const op = b.dataset.op;
    if (op === 'dedupe') out = [...new Set(lines)];
    else if (op === 'spaces') out = [lines.join('\n').replace(/[ \t]+/g, ' ').replace(/ +\n/g, '\n')].join('').split('\n');
    else if (op === 'blank') out = lines.filter((l) => l.trim());
    else if (op === 'trim') out = lines.map((l) => l.trim());
    else if (op === 'sort') out = [...lines].sort((a, b) => a.localeCompare(b));
    else if (op === 'rsort') out = [...lines].sort((a, b) => b.localeCompare(a));
    else if (op === 'reverse') out = [...lines].reverse();
    else if (op === 'number') out = lines.map((l, i) => `${i + 1}. ${l}`);
    root.querySelector('#tcIn').value = out.join('\n');
    analytics.trackToolComplete(toolId);
  }));
  root.querySelector('#tcCopy').addEventListener('click', () => { navigator.clipboard.writeText(root.querySelector('#tcIn').value); toast('Copied'); });
}

function renderFindReplace(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="field-row"><label>Text</label><textarea id="frIn" placeholder="Paste text…"></textarea></div>
    <div class="tool-row">
      <div class="field-row"><label>Find</label><input type="text" id="frFind"/></div>
      <div class="field-row"><label>Replace with</label><input type="text" id="frRep"/></div>
      <div class="field-row"><label>&nbsp;</label><label class="checkbox-row"><input type="checkbox" id="frRegex"/> Regex</label></div>
      <div class="field-row"><label>&nbsp;</label><label class="checkbox-row"><input type="checkbox" id="frCase"/> Case sensitive</label></div>
    </div>
    <div class="actions">
      <button id="frGo" class="btn btn-primary">Replace all</button>
      <button id="frCopy" class="btn btn-outline">Copy result</button>
    </div>
  </div>`;
  root.querySelector('#frGo').addEventListener('click', () => {
    const t = root.querySelector('#frIn').value;
    const find = root.querySelector('#frFind').value;
    const rep = root.querySelector('#frRep').value;
    const regex = root.querySelector('#frRegex').checked;
    const cs = root.querySelector('#frCase').checked;
    if (!find) return;
    try {
      const flags = cs ? 'g' : 'gi';
      const pattern = regex ? new RegExp(find, flags) : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      root.querySelector('#frIn').value = t.replace(pattern, rep);
      analytics.trackToolComplete(toolId);
      toast('Replaced');
    } catch (e) { toast('Invalid regex', 'error'); }
  });
  root.querySelector('#frCopy').addEventListener('click', () => { navigator.clipboard.writeText(root.querySelector('#frIn').value); toast('Copied'); });
}

function renderTextToPdf(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="field-row"><label>Text</label><textarea id="tpIn" placeholder="Enter text to convert to PDF…" style="min-height:200px"></textarea></div>
    <div class="tool-row">
      <div class="field-row"><label>Font size (pt)</label><input type="number" id="tpSize" value="11" min="8" max="24"/></div>
      <div class="field-row"><label>Title (optional)</label><input type="text" id="tpTitle"/></div>
    </div>
    <div class="actions"><button id="tpGo" class="btn btn-primary">${icon('file', 16)} Generate PDF</button></div>
  </div>`;
  root.querySelector('#tpGo').addEventListener('click', async () => {
    const text = root.querySelector('#tpIn').value;
    if (!text.trim()) return toast('Enter some text', 'error');
    const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const size = +root.querySelector('#tpSize').value;
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const margin = 50;
    let y = margin;
    const title = root.querySelector('#tpTitle').value.trim();
    if (title) {
      doc.setFontSize(size + 6); doc.setFont(undefined, 'bold');
      doc.text(title, margin, y);
      y += size + 14;
      doc.setFontSize(size); doc.setFont(undefined, 'normal');
    }
    const lines = doc.splitTextToSize(text, pw - margin * 2);
    lines.forEach((line) => {
      if (y > ph - margin) { doc.addPage(); y = margin; }
      doc.text(line, margin, y);
      y += size * 1.4;
    });
    doc.save('text.pdf');
    analytics.trackToolComplete(toolId); analytics.trackToolDownload(toolId);
    toast('PDF saved', 'success');
  });
}

function renderJsonFormatter(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="field-row"><label>JSON</label><textarea id="jfIn" placeholder='{"hello": "world"}' style="min-height:200px"></textarea></div>
    <div class="field-group">
      <button id="jfFormat" class="btn btn-primary">Format (2 spaces)</button>
      <button id="jfMinify" class="btn btn-outline">Minify</button>
      <button id="jfValidate" class="btn btn-outline">Validate</button>
      <button id="jfCopy" class="btn btn-outline">Copy</button>
    </div>
    <div id="jfStatus" class="hidden" style="margin-top:12px"></div>
  </div>`;
  const status = root.querySelector('#jfStatus');
  const setStatus = (msg, ok) => {
    status.classList.remove('hidden');
    status.className = 'hint-note';
    status.style.borderLeftColor = ok ? 'var(--success)' : 'var(--danger)';
    status.style.background = ok ? '#dcfce7' : '#fee2e2';
    status.style.color = ok ? '#166534' : '#7f1d1d';
    status.textContent = msg;
  };
  root.querySelector('#jfFormat').addEventListener('click', () => {
    try { root.querySelector('#jfIn').value = JSON.stringify(JSON.parse(root.querySelector('#jfIn').value), null, 2); setStatus('✓ Valid JSON — formatted', true); analytics.trackToolComplete(toolId); }
    catch (e) { setStatus('✗ ' + e.message, false); }
  });
  root.querySelector('#jfMinify').addEventListener('click', () => {
    try { root.querySelector('#jfIn').value = JSON.stringify(JSON.parse(root.querySelector('#jfIn').value)); setStatus('✓ Valid JSON — minified', true); }
    catch (e) { setStatus('✗ ' + e.message, false); }
  });
  root.querySelector('#jfValidate').addEventListener('click', () => {
    try { JSON.parse(root.querySelector('#jfIn').value); setStatus('✓ Valid JSON', true); }
    catch (e) { setStatus('✗ ' + e.message, false); }
  });
  root.querySelector('#jfCopy').addEventListener('click', () => { navigator.clipboard.writeText(root.querySelector('#jfIn').value); toast('Copied'); });
}

function renderJsonCsv(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="field-row"><label>Input (JSON array of objects, or CSV)</label><textarea id="jcIn" placeholder='[{"name":"Alice","age":30}]' style="min-height:180px"></textarea></div>
    <div class="field-group">
      <button id="jcToCsv" class="btn btn-primary">JSON → CSV</button>
      <button id="jcToJson" class="btn btn-primary">CSV → JSON</button>
      <button id="jcCopy" class="btn btn-outline">Copy result</button>
      <button id="jcDownload" class="btn btn-outline">Download</button>
    </div>
    <div class="field-row"><label>Result</label><div class="result-box" id="jcOut"></div></div>
  </div>`;
  root.querySelector('#jcToCsv').addEventListener('click', () => {
    try {
      const arr = JSON.parse(root.querySelector('#jcIn').value);
      if (!Array.isArray(arr) || !arr.length) throw new Error('Expected non-empty array');
      const keys = [...new Set(arr.flatMap(Object.keys))];
      const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const csv = [keys.join(','), ...arr.map((o) => keys.map((k) => esc(o[k])).join(','))].join('\n');
      root.querySelector('#jcOut').textContent = csv;
      analytics.trackToolComplete(toolId);
    } catch (e) { toast(e.message, 'error'); }
  });
  root.querySelector('#jcToJson').addEventListener('click', () => {
    try {
      const lines = root.querySelector('#jcIn').value.split(/\r?\n/).filter(Boolean);
      const parseRow = (line) => {
        const out = []; let cur = '', q = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
          else { if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
        }
        out.push(cur); return out;
      };
      const headers = parseRow(lines[0]);
      const json = lines.slice(1).map((l) => { const r = parseRow(l); return Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])); });
      root.querySelector('#jcOut').textContent = JSON.stringify(json, null, 2);
      analytics.trackToolComplete(toolId);
    } catch (e) { toast('CSV parse failed', 'error'); }
  });
  root.querySelector('#jcCopy').addEventListener('click', () => { navigator.clipboard.writeText(root.querySelector('#jcOut').textContent); toast('Copied'); });
  root.querySelector('#jcDownload').addEventListener('click', () => {
    const t = root.querySelector('#jcOut').textContent;
    if (!t) return;
    download(new Blob([t], { type: 'text/plain' }), 'converted.txt');
    analytics.trackToolDownload(toolId);
  });
}

function renderMarkdownHtml(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="field-row"><label>Input</label><textarea id="mhIn" placeholder="# Hello\n\n**Bold** text" style="min-height:180px"></textarea></div>
    <div class="field-group">
      <button id="mhToHtml" class="btn btn-primary">Markdown → HTML</button>
      <button id="mhToMd" class="btn btn-primary">HTML → Markdown</button>
      <button id="mhCopy" class="btn btn-outline">Copy result</button>
    </div>
    <div class="field-row"><label>Result</label><div class="result-box" id="mhOut"></div></div>
    <div class="field-row" style="margin-top:16px"><label>Rendered preview</label><div class="result-box" id="mhPreview" style="font-family:var(--font);background:var(--surface)"></div></div>
  </div>`;
  root.querySelector('#mhToHtml').addEventListener('click', async () => {
    const md = root.querySelector('#mhIn').value;
    // minimal MD→HTML (no external lib needed)
    let html = md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
      .replace(/^\* (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^/, '<p>').replace(/$/, '</p>');
    root.querySelector('#mhOut').textContent = html;
    root.querySelector('#mhPreview').innerHTML = html;
    analytics.trackToolComplete(toolId);
  });
  root.querySelector('#mhToMd').addEventListener('click', () => {
    let md = root.querySelector('#mhIn').value
      .replace(/<h1>(.*?)<\/h1>/g, '# $1')
      .replace(/<h2>(.*?)<\/h2>/g, '## $1')
      .replace(/<h3>(.*?)<\/h3>/g, '### $1')
      .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
      .replace(/<em>(.*?)<\/em>/g, '*$1*')
      .replace(/<code>(.*?)<\/code>/g, '`$1`')
      .replace(/<a href="(.*?)">(.*?)<\/a>/g, '[$2]($1)')
      .replace(/<li>(.*?)<\/li>/g, '* $1')
      .replace(/<\/?ul>/g, '')
      .replace(/<\/?p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    root.querySelector('#mhOut').textContent = md;
    analytics.trackToolComplete(toolId);
  });
  root.querySelector('#mhCopy').addEventListener('click', () => { navigator.clipboard.writeText(root.querySelector('#mhOut').textContent); toast('Copied'); });
}

export const TEXT_TOOLS = {
  'word-count':     { name: 'Word Count',       render: renderWordCount },
  'case-converter': { name: 'Case Converter',   render: renderCaseConverter },
  'cleaner':        { name: 'Line Cleaner',     render: renderTextCleaner },
  'find-replace':   { name: 'Find & Replace',   render: renderFindReplace },
  'text-to-pdf':    { name: 'Text → PDF',       render: renderTextToPdf },
  'json-formatter': { name: 'JSON Formatter',   render: renderJsonFormatter },
  'json-csv':       { name: 'JSON ↔ CSV',        render: renderJsonCsv },
  'markdown-html':  { name: 'Markdown ↔ HTML',   render: renderMarkdownHtml },
};