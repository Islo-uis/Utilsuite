import { analytics } from './analytics.js';
import { $, $$, icon, escapeHTML } from './utils.js';
import { IMAGE_TOOLS } from './tools/image.js';
import { PDF_TOOLS } from './tools/pdf.js';
import { VIDEO_TOOLS } from './tools/video.js';

(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');
  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  });
})();

const CATEGORIES = [
  {
    id: 'image',
    name: 'Image Tools',
    desc: 'Remove backgrounds, compress, resize, convert, and format images for social media.',
    tools: IMAGE_TOOLS,
    visual: `<div class="cat-visual cat-image">
      <div class="cv-half left"></div>
      <div class="cv-half right"></div>
      <div class="cv-subject"></div>
    </div>`,
  },
  {
    id: 'pdf',
    name: 'PDF Tools',
    desc: 'Create, merge, split, compare, redact, sign, and password-protect PDF documents.',
    tools: PDF_TOOLS,
    visual: `<div class="cat-visual cat-pdf">
      <div class="pdf-page back"></div>
      <div class="pdf-page mid"></div>
      <div class="pdf-page front">
        <div class="pdf-line"></div><div class="pdf-line short"></div>
        <div class="pdf-line"></div><div class="pdf-line short"></div>
      </div>
      <div class="pdf-badge">PDF</div>
    </div>`,
  },
  {
    id: 'video',
    name: 'Video Tools',
    desc: 'Convert videos to WebM in your browser and download from streaming sources.',
    tools: VIDEO_TOOLS,
    visual: `<div class="cat-visual cat-video">
      <div class="film-strip">
        ${Array.from({length: 6}, () => '<div class="film-frame"></div>').join('')}
      </div>
    </div>`,
  },
];

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [catId, toolId] = hash.split('/');
  const main = $('#main');

  if (!catId) {
    analytics.trackPageview('home');
    main.innerHTML = renderHome();
    $$('.category-card').forEach((card) => card.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      location.hash = '#/' + card.dataset.cat;
    }));
    return;
  }

  const cat = CATEGORIES.find((c) => c.id === catId);
  if (!cat) { main.innerHTML = notFound(); return; }

  const activeToolId = toolId || Object.keys(cat.tools)[0];
  const activeTool = cat.tools[activeToolId];
  if (!activeTool) { main.innerHTML = notFound(); return; }

  analytics.trackPageview('category/' + cat.id + '/' + activeToolId);

  const toolIds = Object.keys(cat.tools);

  main.innerHTML =
    `<a class="back-link" href="#/">${icon('arrowLeft', 14)} All tools</a>` +
    `<div class="tool-page">` +
      `<div class="tool-header">` +
        `<h2>${escapeHTML(cat.name)}</h2>` +
        `<p>${escapeHTML(cat.desc)}</p>` +
      `</div>` +
      `<div class="tool-tabs" role="tablist">` +
        toolIds.map((tid) => {
          const t = cat.tools[tid];
          return `<a class="tool-tab ${tid === activeToolId ? 'active' : ''}" href="#/${cat.id}/${tid}" role="tab" data-tool="${tid}">${escapeHTML(t.name)}</a>`;
        }).join('') +
      `</div>` +
      `<div id="toolRoot"></div>` +
    `</div>`;

  $$('.tool-tab').forEach((tab) => tab.addEventListener('click', () => {
    analytics.trackToolOpen(tab.dataset.tool);
  }));

  activeTool.render($('#toolRoot'), activeToolId);
}

function renderHome() {
  return `
    <section class="hero">
      <h1>Free tools that run in your browser</h1>
      <p>No uploads. No sign-up. No tracking of your files. Everything is processed locally on your device.</p>
    </section>
    <section class="category-grid" aria-label="Tool categories">
      ${CATEGORIES.map((c) => `
        <a class="category-card" href="#/${c.id}" data-cat="${c.id}">
          <div class="category-visual">${c.visual}</div>
          <div class="category-body">
            <h3>${escapeHTML(c.name)}</h3>
            <p>${escapeHTML(c.desc)}</p>
            <div class="category-meta">
              <span class="tool-count">${Object.keys(c.tools).length} tool${Object.keys(c.tools).length === 1 ? '' : 's'}</span>
              <span class="cat-arrow">Explore →</span>
            </div>
          </div>
        </a>
      `).join('')}
    </section>`;
}

function notFound() {
  return `<div class="empty-state"><h2>Page not found</h2><p><a href="#/">Return home</a></p></div>`;
}

window.addEventListener('hashchange', route);
route();