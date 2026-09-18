import { analytics } from '../analytics.js';
import { icon, toast, loadImage, makeDropZone } from '../utils.js';

/* ============================================================
   Color Picker (from image)
   ============================================================ */
function renderColorPicker(root, toolId) {
  let img = null;
  root.innerHTML = `
    <div class="panel">
      <div id="cpDrop"></div>
      <div id="cpWorkspace" class="hidden">
        <p class="muted" style="margin:12px 0">Click anywhere on the image to sample the color.</p>
        <div class="cp-image-wrap"><canvas id="cpCanvas"></canvas></div>
        <div class="cp-readout">
          <div class="cp-swatch" id="cpSwatch"></div>
          <div class="cp-values">
            <div class="cp-row"><span class="cp-lbl">HEX</span><code id="cpHex">—</code><button class="cp-copy" data-copy="cpHex">Copy</button></div>
            <div class="cp-row"><span class="cp-lbl">RGB</span><code id="cpRgb">—</code><button class="cp-copy" data-copy="cpRgb">Copy</button></div>
            <div class="cp-row"><span class="cp-lbl">HSL</span><code id="cpHsl">—</code><button class="cp-copy" data-copy="cpHsl">Copy</button></div>
          </div>
        </div>
        <div id="cpHistory" class="cp-history"></div>
      </div>
    </div>`;

  const history = [];

  root.querySelector('#cpDrop').appendChild(makeDropZone({
    accept: 'image/*', multiple: false,
    title: 'Drop an image', hint: 'Click any pixel to sample',
    onFiles: async ([f]) => {
      img = await loadImage(f);
      const c = root.querySelector('#cpCanvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      root.querySelector('#cpWorkspace').classList.remove('hidden');
      analytics.trackToolStart(toolId);
    },
  }));

  root.querySelector('#cpCanvas').addEventListener('click', (e) => {
    if (!img) return;
    const c = root.querySelector('#cpCanvas');
    const rect = c.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (c.width / rect.width));
    const y = Math.round((e.clientY - rect.top) * (c.height / rect.height));
    const [r, g, b] = c.getContext('2d').getImageData(x, y, 1, 1).data;
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    const hsl = rgbToHsl(r, g, b);
    root.querySelector('#cpSwatch').style.background = hex;
    root.querySelector('#cpHex').textContent = hex.toUpperCase();
    root.querySelector('#cpRgb').textContent = `rgb(${r}, ${g}, ${b})`;
    root.querySelector('#cpHsl').textContent = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
    history.unshift(hex.toUpperCase());
    if (history.length > 12) history.pop();
    renderHistory();
    analytics.trackToolComplete(toolId);
  });

  root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
    navigator.clipboard.writeText(root.querySelector('#' + b.dataset.copy).textContent);
    toast('Copied');
  }));

  function renderHistory() {
    root.querySelector('#cpHistory').innerHTML = history.map((h) => `
      <button class="cp-chip" data-color="${h}" style="background:${h}" title="${h}"></button>`).join('');
    root.querySelectorAll('.cp-chip').forEach((c) => c.addEventListener('click', () => {
      navigator.clipboard.writeText(c.dataset.color);
      toast('Copied ' + c.dataset.color);
    }));
  }
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}

/* ============================================================
   Color Converter (HEX ↔ RGB ↔ HSL)
   ============================================================ */
function renderColorConverter(root, toolId) {
  root.innerHTML = `
    <div class="panel">
      <div class="cc-swatch-bar" id="ccBar" style="background:#3b82f6"></div>
      <div class="inv-grid">
        <div class="field-row"><label>HEX</label><input type="text" id="ccHex" value="#3b82f6"/></div>
        <div class="field-row"><label>RGB</label><input type="text" id="ccRgb" value="59, 130, 246"/></div>
        <div class="field-row"><label>HSL</label><input type="text" id="ccHsl" value="217, 91%, 60%"/></div>
        <div class="field-row"><label>Native picker</label><input type="color" id="ccPicker" value="#3b82f6"/></div>
      </div>
      <div class="actions">
        <button id="ccRandom" class="btn btn-outline">${icon('image', 16)} Random color</button>
      </div>
    </div>`;

  const hexEl = root.querySelector('#ccHex');
  const rgbEl = root.querySelector('#ccRgb');
  const hslEl = root.querySelector('#ccHsl');
  const picker = root.querySelector('#ccPicker');
  const bar = root.querySelector('#ccBar');

  const fromHex = (hex) => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.replace('#', ''));
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  };
  const toHex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const toHslString = (r, g, b) => {
    const h = rgbToHsl(r, g, b);
    return `${h.h}, ${h.s}%, ${h.l}%`;
  };

  const apply = (hex) => {
    const c = fromHex(hex);
    if (!c) return;
    hexEl.value = hex.toUpperCase();
    rgbEl.value = `${c.r}, ${c.g}, ${c.b}`;
    hslEl.value = toHslString(c.r, c.g, c.b);
    picker.value = hex;
    bar.style.background = hex;
    analytics.trackToolComplete(toolId);
  };

  hexEl.addEventListener('input', () => {
    const c = fromHex(hexEl.value);
    if (c) apply(toHex(c.r, c.g, c.b));
  });
  rgbEl.addEventListener('input', () => {
    const m = rgbEl.value.split(',').map((s) => parseInt(s.trim(), 10));
    if (m.length === 3 && m.every((n) => !isNaN(n))) apply(toHex(...m));
  });
  hslEl.addEventListener('input', () => {
    const m = /(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?/.exec(hslEl.value);
    if (m) {
      const rgb = hslToRgb(+m[1], +m[2], +m[3]);
      apply(toHex(rgb.r, rgb.g, rgb.b));
    }
  });
  picker.addEventListener('input', () => apply(picker.value));
  root.querySelector('#ccRandom').addEventListener('click', () => {
    const r = Math.floor(Math.random() * 256), g = Math.floor(Math.random() * 256), b = Math.floor(Math.random() * 256);
    apply(toHex(r, g, b));
  });

  apply('#3b82f6');
}

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

/* ============================================================
   Palette Generator
   ============================================================ */
function renderPaletteGenerator(root, toolId) {
  root.innerHTML = `
    <div class="panel">
      <div class="field-row"><label>Base color</label>
        <div style="display:flex;gap:10px;align-items:center">
          <input type="color" id="pgBase" value="#3b82f6" style="max-width:80px"/>
          <select id="pgHarmony" style="flex:1">
            <option value="analogous">Analogous</option>
            <option value="complementary" selected>Complementary</option>
            <option value="triadic">Triadic</option>
            <option value="tetradic">Tetradic</option>
            <option value="monochromatic">Monochromatic</option>
            <option value="shades">Shades (light → dark)</option>
          </select>
          <button id="pgGen" class="btn btn-primary">Generate</button>
        </div>
      </div>
      <div id="pgOut" class="pg-output"></div>
      <div class="actions">
        <button id="pgCopy" class="btn btn-outline">Copy all HEX</button>
      </div>
    </div>`;

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const hexToHsl = (hex) => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.replace('#', ''));
    if (!m) return { h: 0, s: 0, l: 0 };
    return rgbToHsl(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16));
  };
  const hslToHex = (h, s, l) => {
    const { r, g, b } = hslToRgb(h, s, l);
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  };

  const gen = () => {
    const hex = root.querySelector('#pgBase').value;
    const mode = root.querySelector('#pgHarmony').value;
    const base = hexToHsl(hex);
    const colors = [];
    const push = (h, s, l) => colors.push(hslToHex((h + 360) % 360, clamp(s, 0, 100), clamp(l, 0, 100)));

    if (mode === 'analogous') [-30, -15, 0, 15, 30].forEach((d) => push(base.h + d, base.s, base.l));
    else if (mode === 'complementary') [0, 180].forEach((d) => {
      push(base.h + d, base.s, base.l);
      push(base.h + d, base.s, base.l + 15);
      push(base.h + d, base.s, base.l - 15);
    });
    else if (mode === 'triadic') [0, 120, 240].forEach((d) => {
      push(base.h + d, base.s, base.l);
      push(base.h + d, base.s, base.l + 12);
      push(base.h + d, base.s, base.l - 12);
    });
    else if (mode === 'tetradic') [0, 90, 180, 270].forEach((d) => {
      push(base.h + d, base.s, base.l);
      push(base.h + d, base.s, base.l + 15);
    });
    else if (mode === 'monochromatic') [20, 35, 50, 65, 80].forEach((l) => push(base.h, base.s, l));
    else if (mode === 'shades') [90, 75, 60, 45, 30, 15, 8].forEach((l) => push(base.h, base.s, l));

    root.querySelector('#pgOut').innerHTML = colors.map((c) => `
      <button class="pg-swatch" data-color="${c}" style="background:${c}">
        <span>${c}</span>
      </button>`).join('');
    root.querySelectorAll('.pg-swatch').forEach((s) => s.addEventListener('click', () => {
      navigator.clipboard.writeText(s.dataset.color);
      toast('Copied ' + s.dataset.color);
    }));
    analytics.trackToolComplete(toolId);
  };

  root.querySelector('#pgGen').addEventListener('click', gen);
  root.querySelector('#pgBase').addEventListener('input', gen);
  root.querySelector('#pgHarmony').addEventListener('change', gen);
  root.querySelector('#pgCopy').addEventListener('click', () => {
    const hexes = [...root.querySelectorAll('.pg-swatch')].map((s) => s.dataset.color).join('\n');
    navigator.clipboard.writeText(hexes);
    toast('Palette copied');
    analytics.trackToolDownload(toolId);
  });
  gen();
}

/* ============================================================
   Contrast Checker (WCAG)
   ============================================================ */
function renderContrastChecker(root, toolId) {
  root.innerHTML = `
    <div class="panel">
      <div class="inv-grid">
        <div class="field-row"><label>Foreground</label><input type="color" id="ctFg" value="#0f172a"/></div>
        <div class="field-row"><label>Background</label><input type="color" id="ctBg" value="#ffffff"/></div>
      </div>
      <div class="ct-preview" id="ctPreview">
        <p style="font-size:32px;font-weight:800;margin:0">Large text sample</p>
        <p style="font-size:16px;margin:8px 0 0">Normal body text — check readability here.</p>
        <p style="font-size:12px;margin:8px 0 0">Small caption text for fine print checks.</p>
      </div>
      <div class="ct-ratio" id="ctRatio">—</div>
      <div id="ctResults" class="ct-results"></div>
    </div>`;

  const fg = root.querySelector('#ctFg');
  const bg = root.querySelector('#ctBg');

  const hexToRgb = (h) => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
  };
  const lum = ({ r, g, b }) => {
    const c = [r, g, b].map((v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };

  const update = () => {
    const F = hexToRgb(fg.value), B = hexToRgb(bg.value);
    const ratio = (Math.max(lum(F), lum(B)) + 0.05) / (Math.min(lum(F), lum(B)) + 0.05);
    const preview = root.querySelector('#ctPreview');
    preview.style.background = bg.value;
    preview.style.color = fg.value;
    root.querySelector('#ctRatio').innerHTML = `<b>${ratio.toFixed(2)}:1</b> contrast ratio`;
    const passes = (min) => ratio >= min;
    root.querySelector('#ctResults').innerHTML = `
      <div class="ct-check ${passes(3) ? 'ok' : 'no'}"><span class="lvl">AA Large</span><span>${passes(3) ? 'Pass' : 'Fail'}</span></div>
      <div class="ct-check ${passes(4.5) ? 'ok' : 'no'}"><span class="lvl">AA Normal</span><span>${passes(4.5) ? 'Pass' : 'Fail'}</span></div>
      <div class="ct-check ${passes(7) ? 'ok' : 'no'}"><span class="lvl">AAA Normal</span><span>${passes(7) ? 'Pass' : 'Fail'}</span></div>`;
    analytics.trackToolComplete(toolId);
  };

  fg.addEventListener('input', update);
  bg.addEventListener('input', update);
  update();
}

export const COLOR_TOOLS = {
  'picker':    { name: 'Color Picker',      render: renderColorPicker },
  'converter': { name: 'Color Converter',   render: renderColorConverter },
  'palette':   { name: 'Palette Generator', render: renderPaletteGenerator },
  'contrast':  { name: 'Contrast Checker',  render: renderContrastChecker },
};