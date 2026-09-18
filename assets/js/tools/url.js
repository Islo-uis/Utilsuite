import { analytics } from '../analytics.js';
import { $, icon, toast, download, escapeHTML } from '../utils.js';

/* ---------- QR from URL (uses same QRious lib as image tool) ---------- */
/* ---------- QR from URL ---------- */
async function loadQRious() {
  if (window.QRious) return window.QRious;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js';
    s.onload = () => window.QRious ? resolve(window.QRious) : reject(new Error('QRious failed'));
    s.onerror = () => reject(new Error('QRious failed to load'));
    document.head.appendChild(s);
  });
}

function renderQrFromUrl(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="field-row"><label>URL</label><input type="url" id="qru" placeholder="https://example.com" value="https://"/></div>
    <div style="display:grid;place-items:center;margin:20px 0">
      <canvas id="qruCanvas" style="max-width:280px"></canvas>
    </div>
    <div class="actions">
      <button id="qruCopy" class="btn btn-outline">Copy URL</button>
      <button id="qruSave" class="btn btn-primary">${icon('download', 16)} Download QR</button>
    </div>
  </div>`;

  let qr = null;
  let loading = false;

  const update = async () => {
    const url = root.querySelector('#qru').value || ' ';
    if (!qr) {
      if (loading) return;
      loading = true;
      try {
        const QRious = await loadQRious();
        qr = new QRious({ element: root.querySelector('#qruCanvas'), size: 400, value: url });
        loading = false;
      } catch (e) {
        console.error(e);
        toast('QR library failed to load', 'error');
        loading = false;
        return;
      }
    } else {
      qr.value = url;
    }
    analytics.trackToolStart(toolId);
  };

  root.querySelector('#qru').addEventListener('input', update);
  update();

  root.querySelector('#qruCopy').addEventListener('click', () => {
    navigator.clipboard.writeText(root.querySelector('#qru').value);
    toast('Copied');
  });
  root.querySelector('#qruSave').addEventListener('click', () => {
    if (!qr) return toast('QR not ready yet', 'error');
    const a = document.createElement('a');
    a.href = root.querySelector('#qruCanvas').toDataURL();
    a.download = 'url-qr.png';
    a.click();
    analytics.trackToolComplete(toolId);
    analytics.trackToolDownload(toolId);
  });
}

/* ---------- URL Encoder / Decoder ---------- */
function renderUrlEncodeDecode(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="field-row"><label>Input</label><textarea id="ueIn" placeholder="https://example.com/?q=hello world"></textarea></div>
    <div class="field-group">
      <button id="ueEnc" class="btn btn-primary">Encode</button>
      <button id="ueDec" class="btn btn-outline">Decode</button>
      <button id="ueCopy" class="btn btn-outline">Copy result</button>
    </div>
    <div class="field-row"><label>Result</label><div class="result-box" id="ueOut">(result will appear here)</div></div>
  </div>`;
  const run = (enc) => {
    const v = root.querySelector('#ueIn').value;
    try {
      root.querySelector('#ueOut').textContent = enc ? encodeURIComponent(v) : decodeURIComponent(v);
      analytics.trackToolComplete(toolId);
    } catch (e) { toast('Invalid input', 'error'); }
  };
  root.querySelector('#ueEnc').addEventListener('click', () => run(true));
  root.querySelector('#ueDec').addEventListener('click', () => run(false));
  root.querySelector('#ueCopy').addEventListener('click', () => {
    navigator.clipboard.writeText(root.querySelector('#ueOut').textContent); toast('Copied');
  });
}

/* ---------- Base64 ---------- */
function renderBase64(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="field-row"><label>Input</label><textarea id="b64In" placeholder="Type here…"></textarea></div>
    <div class="field-group">
      <button id="b64Enc" class="btn btn-primary">Encode</button>
      <button id="b64Dec" class="btn btn-outline">Decode</button>
      <button id="b64Copy" class="btn btn-outline">Copy</button>
    </div>
    <div class="field-row"><label>Result</label><div class="result-box" id="b64Out"></div></div>
  </div>`;
  root.querySelector('#b64Enc').addEventListener('click', () => {
    try {
      const v = root.querySelector('#b64In').value;
      root.querySelector('#b64Out').textContent = btoa(unescape(encodeURIComponent(v)));
      analytics.trackToolComplete(toolId);
    } catch { toast('Encode failed', 'error'); }
  });
  root.querySelector('#b64Dec').addEventListener('click', () => {
    try {
      root.querySelector('#b64Out').textContent = decodeURIComponent(escape(atob(root.querySelector('#b64In').value.trim())));
      analytics.trackToolComplete(toolId);
    } catch { toast('Invalid Base64', 'error'); }
  });
  root.querySelector('#b64Copy').addEventListener('click', () => {
    navigator.clipboard.writeText(root.querySelector('#b64Out').textContent); toast('Copied');
  });
}

/* ---------- HTML Entities ---------- */
function renderHtmlEntities(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="field-row"><label>Input</label><textarea id="heIn" placeholder="<div>Hello & welcome</div>"></textarea></div>
    <div class="field-group">
      <button id="heEnc" class="btn btn-primary">Encode</button>
      <button id="heDec" class="btn btn-outline">Decode</button>
      <button id="heCopy" class="btn btn-outline">Copy</button>
    </div>
    <div class="field-row"><label>Result</label><div class="result-box" id="heOut"></div></div>
  </div>`;
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const rev = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
  root.querySelector('#heEnc').addEventListener('click', () => {
    root.querySelector('#heOut').textContent = root.querySelector('#heIn').value.replace(/[&<>"']/g, (c) => map[c]);
    analytics.trackToolComplete(toolId);
  });
  root.querySelector('#heDec').addEventListener('click', () => {
    root.querySelector('#heOut').textContent = root.querySelector('#heIn').value.replace(/&(amp|lt|gt|quot|#39);/g, (m) => rev[m] || m);
  });
  root.querySelector('#heCopy').addEventListener('click', () => {
    navigator.clipboard.writeText(root.querySelector('#heOut').textContent); toast('Copied');
  });
}

/* ---------- UTM Link Builder ---------- */
function renderUtmBuilder(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="tool-row">
      <div class="field-row"><label>Base URL *</label><input type="url" id="utmUrl" placeholder="https://example.com/page"/></div>
      <div class="field-row"><label>Source *</label><input type="text" id="utmSource" placeholder="newsletter"/></div>
      <div class="field-row"><label>Medium *</label><input type="text" id="utmMedium" placeholder="email"/></div>
      <div class="field-row"><label>Campaign</label><input type="text" id="utmCampaign" placeholder="spring_sale"/></div>
      <div class="field-row"><label>Term</label><input type="text" id="utmTerm" placeholder="running+shoes"/></div>
      <div class="field-row"><label>Content</label><input type="text" id="utmContent" placeholder="header_cta"/></div>
    </div>
    <div class="field-row"><label>Generated URL</label><div class="result-box" id="utmOut" style="word-break:break-all">Fill in the fields above…</div></div>
    <div class="actions">
      <button id="utmCopy" class="btn btn-outline">Copy</button>
      <button id="utmOpen" class="btn btn-primary">Open</button>
    </div>
  </div>`;
  const fields = ['utmUrl', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent'];
  const update = () => {
    const url = root.querySelector('#utmUrl').value.trim();
    const src = root.querySelector('#utmSource').value.trim();
    const med = root.querySelector('#utmMedium').value.trim();
    if (!url || !src || !med) { root.querySelector('#utmOut').textContent = 'Fill in URL, Source, and Medium.'; return; }
    try {
      const u = new URL(url);
      u.searchParams.set('utm_source', src);
      u.searchParams.set('utm_medium', med);
      ['utmCampaign:utm_campaign', 'utmTerm:utm_term', 'utmContent:utm_content'].forEach((pair) => {
        const [f, p] = pair.split(':');
        const v = root.querySelector('#' + f).value.trim();
        if (v) u.searchParams.set(p, v);
      });
      root.querySelector('#utmOut').textContent = u.toString();
      analytics.trackToolComplete(toolId);
    } catch { root.querySelector('#utmOut').textContent = 'Invalid URL'; }
  };
  fields.forEach((f) => root.querySelector('#' + f).addEventListener('input', update));
  root.querySelector('#utmCopy').addEventListener('click', () => {
    navigator.clipboard.writeText(root.querySelector('#utmOut').textContent); toast('Copied');
  });
  root.querySelector('#utmOpen').addEventListener('click', () => {
    const t = root.querySelector('#utmOut').textContent;
    if (t.startsWith('http')) window.open(t, '_blank');
  });
}

/* ---------- Favicon Generator (emoji / text → PNG/ICO) ---------- */
function renderFaviconGenerator(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="tool-row">
      <div class="field-row"><label>Emoji or 1-2 characters</label><input type="text" id="fvText" value="🚀" maxlength="2"/></div>
      <div class="field-row"><label>Background color</label><input type="color" id="fvBg" value="#0f172a"/></div>
      <div class="field-row"><label>Size</label><select id="fvSize"><option value="32">32×32</option><option value="64" selected>64×64</option><option value="128">128×128</option><option value="180">180×180 (Apple touch)</option><option value="512">512×512</option></select></div>
    </div>
    <div style="display:grid;place-items:center;margin:20px 0">
      <canvas id="fvCanvas" style="max-width:160px;border-radius:14px;box-shadow:var(--shadow)"></canvas>
    </div>
    <div class="actions">
      <button id="fvDl" class="btn btn-primary">${icon('download', 16)} Download PNG</button>
    </div>
  </div>`;
  const draw = () => {
    const size = +root.querySelector('#fvSize').value;
    const c = root.querySelector('#fvCanvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = root.querySelector('#fvBg').value;
    ctx.fillRect(0, 0, size, size);
    ctx.font = `${size * 0.6}px -apple-system, "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(root.querySelector('#fvText').value || '?', size / 2, size / 2 + size * 0.02);
    analytics.trackToolComplete(toolId);
  };
  ['#fvText', '#fvBg', '#fvSize'].forEach((s) => root.querySelector(s).addEventListener('input', draw));
  draw();
  root.querySelector('#fvDl').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = root.querySelector('#fvCanvas').toDataURL('image/png');
    a.download = `favicon-${root.querySelector('#fvSize').value}.png`; a.click();
    analytics.trackToolDownload(toolId);
  });
}

/* ---------- Meta Tag Generator ---------- */
function renderMetaTags(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="tool-row">
      <div class="field-row"><label>Page title *</label><input type="text" id="mtTitle" value="My Website"/></div>
      <div class="field-row"><label>Description *</label><input type="text" id="mtDesc" placeholder="A short description for search engines"/></div>
      <div class="field-row"><label>URL</label><input type="url" id="mtUrl" placeholder="https://example.com"/></div>
      <div class="field-row"><label>Image URL</label><input type="url" id="mtImg" placeholder="https://example.com/og.png"/></div>
      <div class="field-row"><label>Author</label><input type="text" id="mtAuthor" placeholder="Your Name"/></div>
      <div class="field-row"><label>Twitter handle</label><input type="text" id="mtTwitter" placeholder="@yourhandle"/></div>
    </div>
    <div class="field-row"><label>Generated meta tags</label><div class="result-box" id="mtOut" style="font-size:12px"></div></div>
    <div class="actions"><button id="mtCopy" class="btn btn-primary">Copy meta tags</button></div>
  </div>`;
  const update = () => {
    const g = (id) => root.querySelector('#' + id).value.trim();
    const tags = [];
    if (g('mtTitle')) { tags.push(`<title>${g('mtTitle')}</title>`); tags.push(`<meta property="og:title" content="${g('mtTitle')}">`); tags.push(`<meta name="twitter:title" content="${g('mtTitle')}">`); }
    if (g('mtDesc')) { tags.push(`<meta name="description" content="${g('mtDesc')}">`); tags.push(`<meta property="og:description" content="${g('mtDesc')}">`); tags.push(`<meta name="twitter:description" content="${g('mtDesc')}">`); }
    if (g('mtUrl')) { tags.push(`<link rel="canonical" href="${g('mtUrl')}">`); tags.push(`<meta property="og:url" content="${g('mtUrl')}">`); }
    if (g('mtImg')) { tags.push(`<meta property="og:image" content="${g('mtImg')}">`); tags.push(`<meta name="twitter:image" content="${g('mtImg')}">`); }
    if (g('mtAuthor')) tags.push(`<meta name="author" content="${g('mtAuthor')}">`);
    if (g('mtTwitter')) { tags.push(`<meta name="twitter:card" content="summary_large_image">`); tags.push(`<meta name="twitter:site" content="${g('mtTwitter')}">`); }
    tags.push('<meta property="og:type" content="website">');
    tags.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
    root.querySelector('#mtOut').textContent = tags.join('\n');
    analytics.trackToolComplete(toolId);
  };
  root.querySelectorAll('input').forEach((i) => i.addEventListener('input', update));
  update();
  root.querySelector('#mtCopy').addEventListener('click', () => {
    navigator.clipboard.writeText(root.querySelector('#mtOut').textContent); toast('Copied');
  });
}

/* ---------- Password Generator ---------- */
function renderPasswordGenerator(root, toolId) {
  root.innerHTML = `<div class="panel">
    <div class="field-row"><label>Generated password</label>
      <div class="result-box" id="pgOut" style="font-size:18px;font-weight:700;text-align:center;letter-spacing:0.04em"></div>
    </div>
    <div class="tool-row">
      <div class="field-row"><label>Length: <span id="pgLenVal">20</span></label><input type="range" id="pgLen" min="8" max="128" value="20"/></div>
    </div>
    <div class="field-group">
      <label class="checkbox-row"><input type="checkbox" id="pgUpper" checked/> Uppercase (A-Z)</label>
      <label class="checkbox-row"><input type="checkbox" id="pgLower" checked/> Lowercase (a-z)</label>
      <label class="checkbox-row"><input type="checkbox" id="pgDigits" checked/> Digits (0-9)</label>
      <label class="checkbox-row"><input type="checkbox" id="pgSymbols" checked/> Symbols (!@#$…)</label>
      <label class="checkbox-row"><input type="checkbox" id="pgExclude"/> Exclude ambiguous (0O1lI)</label>
    </div>
    <div class="actions">
      <button id="pgCopy" class="btn btn-primary">Copy</button>
      <button id="pgNew" class="btn btn-outline">Generate new</button>
    </div>
  </div>`;
  const gen = () => {
    const len = +root.querySelector('#pgLen').value;
    const exclude = root.querySelector('#pgExclude').checked;
    let chars = '';
    if (root.querySelector('#pgUpper').checked) chars += exclude ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (root.querySelector('#pgLower').checked) chars += exclude ? 'abcdefghijkmnopqrstuvwxyz' : 'abcdefghijklmnopqrstuvwxyz';
    if (root.querySelector('#pgDigits').checked) chars += exclude ? '23456789' : '0123456789';
    if (root.querySelector('#pgSymbols').checked) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
    if (!chars) { root.querySelector('#pgOut').textContent = 'Select at least one character set'; return; }
    const arr = new Uint32Array(len);
    crypto.getRandomValues(arr);
    let out = '';
    for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
    root.querySelector('#pgOut').textContent = out;
    analytics.trackToolComplete(toolId);
  };
  root.querySelector('#pgLen').addEventListener('input', (e) => root.querySelector('#pgLenVal').textContent = e.target.value);
  root.querySelectorAll('input').forEach((i) => i.addEventListener('input', gen));
  root.querySelector('#pgNew').addEventListener('click', gen);
  root.querySelector('#pgCopy').addEventListener('click', () => {
    navigator.clipboard.writeText(root.querySelector('#pgOut').textContent);
    toast('Password copied', 'success');
    analytics.trackToolDownload(toolId);
  });
  gen();
}

export const URL_TOOLS = {
  'url-codec':     { name: 'URL Encode/Decode',  render: renderUrlEncodeDecode },
  'base64':        { name: 'Base64',             render: renderBase64 },
  'html-entities': { name: 'HTML Entities',      render: renderHtmlEntities },
  'utm-builder':   { name: 'UTM Builder',        render: renderUtmBuilder },
  'favicon':       { name: 'Favicon Generator',  render: renderFaviconGenerator },
  'meta-tags':     { name: 'Meta Tag Generator', render: renderMetaTags },
  'password-gen':  { name: 'Password Generator', render: renderPasswordGenerator },
};