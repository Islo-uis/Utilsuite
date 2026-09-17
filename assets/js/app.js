import { analytics } from './analytics.js';
import { $, $$, icon, escapeHTML } from './utils.js';
import { IMAGE_TOOLS } from './tools/image.js';
import { PDF_TOOLS } from './tools/pdf.js';
import { VIDEO_TOOLS } from './tools/video.js';
import { URL_TOOLS } from './tools/url.js';
import { TEXT_TOOLS } from './tools/text.js';
import { CALC_TOOLS } from './tools/calc.js';

/* ---------- Theme ---------- */
(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');
  const btn = document.querySelector('#themeBtn');
  if (btn) btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  });
})();

/* ---------- Categories ---------- */
const CATEGORIES = [
  {
    id: 'image',
    name: 'Image Tools',
    desc: 'Background removal, compression, resizing, social-media crops, QR codes, OCR, and more.',
    tools: IMAGE_TOOLS,
    visual: `<div class="cat-visual cat-image"><div class="cv-half left"></div><div class="cv-half right"></div><div class="cv-subject"></div></div>`,
  },
  {
    id: 'pdf',
    name: 'PDF & Documents',
    desc: 'Create, edit, split, merge, compare, redact, sign, and password-protect PDFs.',
    tools: PDF_TOOLS,
    visual: `<div class="cat-visual cat-pdf"><div class="pdf-page back"></div><div class="pdf-page mid"></div><div class="pdf-page front"><div class="pdf-line"></div><div class="pdf-line short"></div><div class="pdf-line"></div></div><div class="pdf-badge">PDF</div></div>`,
  },
  {
    id: 'video',
    name: 'Video Tools',
    desc: 'Convert, compress, trim, and extract frames — all in-browser via WebAssembly.',
    tools: VIDEO_TOOLS,
    visual: `<div class="cat-visual cat-video"><div class="film-strip">${Array.from({ length: 6 }, () => '<div class="film-frame"></div>').join('')}</div></div>`,
  },
  {
    id: 'url',
    name: 'URL & Web',
    desc: 'Encode, decode, build UTM links, generate QR codes, favicons, meta tags, and passwords.',
    tools: URL_TOOLS,
    visual: `<div class="cat-visual cat-url"><div class="url-chain"><span></span><span></span><span></span></div><div class="url-globe"></div></div>`,
  },
  {
    id: 'text',
    name: 'Text Tools',
    desc: 'Count, format, convert, sort, deduplicate, and transform text or structured data.',
    tools: TEXT_TOOLS,
    visual: `<div class="cat-visual cat-text"><div class="text-line w1"></div><div class="text-line w2"></div><div class="text-line w3"></div><div class="text-line w4"></div></div>`,
  },
  {
    id: 'calc',
    name: 'Calculators',
    desc: 'Everyday calculators — loans, tax, discounts, units, dates, and time zones.',
    tools: CALC_TOOLS,
    visual: `<div class="cat-visual cat-calc"><div class="calc-screen">125.00</div><div class="calc-keys"><span>7</span><span>8</span><span>9</span><span>4</span><span>5</span><span>6</span><span>1</span><span>2</span><span>3</span></div></div>`,
  },
];

/* ---------- Router ---------- */
function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [catId, toolId] = hash.split('/');
  const main = document.querySelector('#main');
  if (!main) return;

  // Home
  if (!catId) {
    analytics.trackPageview('home');
    main.innerHTML = renderHome();
    document.querySelectorAll('.category-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        location.hash = '#/' + card.dataset.cat;
      });
    });
    return;
  }

  const cat = CATEGORIES.find((c) => c.id === catId);
  if (!cat) {
    main.innerHTML = `<div class="empty-state"><h2>Not found</h2><p><a href="#/">Back home</a></p></div>`;
    return;
  }

  const activeId = toolId || Object.keys(cat.tools)[0];
  const activeTool = cat.tools[activeId];
  if (!activeTool) {
    main.innerHTML = `<div class="empty-state"><h2>Tool not found</h2><p><a href="#/${cat.id}">Back</a></p></div>`;
    return;
  }

  analytics.trackPageview('tool/' + cat.id + '/' + activeId);

  main.innerHTML =
    `<a class="back-link" href="#/">${icon('arrowLeft', 14)} All categories</a>` +
    `<div class="tool-page">` +
      `<div class="tool-header"><h2>${escapeHTML(cat.name)}</h2><p>${escapeHTML(cat.desc)}</p></div>` +
      `<div class="tool-tabs" role="tablist">` +
        Object.keys(cat.tools).map((tid) =>
          `<a class="tool-tab ${tid === activeId ? 'active' : ''}" href="#/${cat.id}/${tid}" role="tab" data-tool="${tid}">${escapeHTML(cat.tools[tid].name)}</a>`
        ).join('') +
      `</div>` +
      `<div id="toolRoot"></div>` +
    `</div>`;

  try {
    activeTool.render(document.querySelector('#toolRoot'), activeId);
  } catch (err) {
    console.error('[tool render failed]', activeId, err);
    document.querySelector('#toolRoot').innerHTML =
      `<div class="hint-note" style="border-left-color:var(--danger);background:#fee2e2;color:#7f1d1d">
        <b>This tool failed to load.</b> ${escapeHTML(String(err.message || err))}. Try a hard refresh.
      </div>`;
  }
}

function renderHome() {
  return `
    <section class="hero">
      <h1>Free tools that run in your browser</h1>
      <p>Over 60 utilities for images, PDFs, video, text, and everyday calculations. No uploads. No sign-up. Everything processes locally on your device.</p>
    </section>
    <section class="category-grid" aria-label="Tool categories">
      ${CATEGORIES.map((c) => `
        <a class="category-card" href="#/${c.id}" data-cat="${c.id}">
          <div class="category-visual">${c.visual}</div>
          <div class="category-body">
            <h3>${escapeHTML(c.name)}</h3>
            <p>${escapeHTML(c.desc)}</p>
            <div class="category-meta">
              <span class="tool-count">${Object.keys(c.tools).length} tools</span>
              <span class="cat-arrow">Explore →</span>
            </div>
          </div>
        </a>
      `).join('')}
    </section>`;
}

window.addEventListener('hashchange', route);
route();