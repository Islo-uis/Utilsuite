import { analytics } from '../analytics.js';
import { $, icon, toast, download, makeDropZone, fmtBytes } from '../utils.js';

/* ============================================================
   MP4 → WebM  (restored, browser-based via ffmpeg.wasm)
   ============================================================ */
let _ffmpeg = null, _ffmpegUtil = null;

async function loadFFmpeg(onLog, onProgress) {
  if (!_ffmpeg) {
    const [{ FFmpeg }, util] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm'),
      import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm'),
    ]);
    _ffmpeg = new FFmpeg();
    _ffmpegUtil = util;
    const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
    await _ffmpeg.load({
      coreURL: await util.toBlobURL(base + '/ffmpeg-core.js', 'text/javascript'),
      wasmURL: await util.toBlobURL(base + '/ffmpeg-core.wasm', 'application/wasm'),
    });
    if (onLog) _ffmpeg.on('log', ({ message }) => onLog(message));
    if (onProgress) _ffmpeg.on('progress', ({ progress }) => onProgress(progress));
  }
  return { ffmpeg: _ffmpeg, util: _ffmpegUtil };
}

function renderMp4ToWebm(root, toolId) {
  root.innerHTML = `
    <div class="panel">
      <div class="format-note">
        <b>Browser-based conversion.</b> Video is processed entirely on your device with WebAssembly. First run downloads ~30 MB. Expect slow conversion for HD clips (a few minutes for a 30-second clip).
      </div>
      <div id="vmDrop"></div>
      <div id="vmWorkspace" class="hidden">
        <div class="status-row">
          <span class="label" id="vmStatus">Preparing…</span>
          <span class="pct" id="vmPct">0%</span>
        </div>
        <div class="progress"><div id="vmBar"></div></div>
        <div class="actions">
          <button id="vmCancel" class="btn btn-outline">Cancel</button>
          <button id="vmDownload" class="btn btn-primary hidden" disabled>${icon('download', 16)} Download WebM</button>
        </div>
      </div>
    </div>`;
  root.querySelector('#vmDrop').appendChild(makeDropZone({
    accept: 'video/mp4,video/*',
    multiple: false,
    title: 'Drop an MP4 video',
    hint: 'Converted to WebM locally in your browser',
    onFiles: ([f]) => run(f),
  }));

  let cancelled = false;
  async function run(file) {
    cancelled = false;
    const ws = root.querySelector('#vmWorkspace');
    const status = root.querySelector('#vmStatus');
    const bar = root.querySelector('#vmBar');
    const pct = root.querySelector('#vmPct');
    const dl = root.querySelector('#vmDownload');
    ws.classList.remove('hidden');
    dl.classList.add('hidden'); dl.disabled = true;
    bar.style.width = '0%'; pct.textContent = '0%';
    status.textContent = 'Loading FFmpeg (first run may take ~30s)…';
    analytics.trackToolStart(toolId);

    try {
      const { ffmpeg, util } = await loadFFmpeg(
        () => {},
        (progress) => {
          const p = Math.max(0, Math.min(99, Math.round(progress * 100)));
          bar.style.width = p + '%'; pct.textContent = p + '%';
        }
      );
      status.textContent = 'Writing input file…';
      const inputName = 'input.mp4';
      const outputName = 'output.webm';
      await ffmpeg.writeFile(inputName, await util.fetchFile(file));
      status.textContent = 'Converting (this may take a while)…';
      await ffmpeg.exec([
        '-i', inputName,
        '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0',
        '-c:a', 'libopus', '-b:a', '96k',
        outputName,
      ]);
      if (cancelled) { status.textContent = 'Cancelled'; return; }
      status.textContent = 'Reading output…';
      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([data.buffer], { type: 'video/webm' });
      bar.style.width = '100%'; pct.textContent = '100%';
      status.textContent = 'Done — ' + fmtBytes(blob.size);
      dl.classList.remove('hidden'); dl.disabled = false;
      dl.onclick = () => {
        download(blob, file.name.replace(/\.[^.]+$/, '') + '.webm');
        analytics.trackToolDownload(toolId);
      };
      analytics.trackToolComplete(toolId);
      toast('Converted to WebM', 'success');
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch (err) {
      console.error(err);
      analytics.trackError(toolId, err);
      status.textContent = 'Conversion failed';
      toast('Conversion failed — see console', 'error');
    }
  }
  root.querySelector('#vmCancel').addEventListener('click', () => {
    cancelled = true;
    toast('Cancelling after next step…');
  });
}

/* ============================================================
   YouTube Downloader
   ============================================================
   HONEST LIMITATION:
   A static GitHub Pages site CANNOT download YouTube videos.
   YouTube blocks cross-origin requests from browsers, and any
   client-only approach (ytdl-core, youtube-dl-js, etc.) either
   relies on a third-party proxy or is quickly broken by YouTube.

   This tool is intentionally a UI shell + configurable backend
   endpoint. The user must supply their own backend URL (e.g.
   a self-hosted cobalt instance or a yt-dlp API wrapper).
   When no backend is configured, the tool explains the
   limitation clearly instead of pretending to work.
   ============================================================ */
const YT_BACKEND_KEY = 'yt_backend_url';

function renderYoutubeDownloader(root, toolId) {
  const savedBackend = localStorage.getItem(YT_BACKEND_KEY) || '';

  root.innerHTML = `
    <div class="panel">
      <div class="format-note" style="border-left-color:var(--warn);background:#fef3c7;color:#78350f">
        <b>Heads up:</b> A static site cannot download YouTube videos on its own — YouTube blocks it. This tool connects to <b>your own</b> backend (a cobalt instance, or a small serverless yt-dlp wrapper). If you have no backend, the tool will explain what to do.
      </div>

      <div class="field-group">
        <div class="field" style="flex:2">
          <label>YouTube URL</label>
          <input type="url" id="ytUrl" placeholder="https://www.youtube.com/watch?v=..." />
        </div>
        <button id="ytGo" class="btn btn-primary">${icon('youtube', 16)} Fetch</button>
      </div>

      <details class="backend-config" ${savedBackend ? '' : 'open'}>
        <summary>Backend configuration (advanced)</summary>
        <p class="muted" style="margin:10px 0">
          Provide the URL of a CORS-enabled endpoint that accepts <code>?url=&lt;video-url&gt;</code>
          and returns JSON with a direct video URL (e.g. <code>{ "url": "https://..." }</code>).
          Popular options: self-hosted <a href="https://github.com/imputnet/cobalt" target="_blank" rel="noopener">cobalt</a>
          instance, or a <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noopener">yt-dlp</a>-based
          serverless wrapper. Do <b>not</b> hardcode credentials here.
        </p>
        <div class="field-group">
          <div class="field" style="flex:3">
            <label>Backend URL</label>
            <input type="url" id="ytBackend" placeholder="https://your-backend.example.com/resolve" value="${savedBackend}"/>
          </div>
          <button id="ytSaveBackend" class="btn btn-outline">Save</button>
        </div>
      </details>

      <div id="ytStatus" class="hidden" style="margin-top:20px">
        <div class="status-row"><span class="label" id="ytStatusText">Fetching…</span></div>
      </div>
      <div id="ytResult" class="hidden" style="margin-top:20px"></div>
    </div>`;

  root.querySelector('#ytSaveBackend').addEventListener('click', () => {
    const v = root.querySelector('#ytBackend').value.trim();
    if (v) localStorage.setItem(YT_BACKEND_KEY, v); else localStorage.removeItem(YT_BACKEND_KEY);
    toast('Backend URL saved');
  });

  root.querySelector('#ytGo').addEventListener('click', async () => {
    const url = root.querySelector('#ytUrl').value.trim();
    const backend = (localStorage.getItem(YT_BACKEND_KEY) || '').trim();
    const status = root.querySelector('#ytStatus');
    const statusText = root.querySelector('#ytStatusText');
    const result = root.querySelector('#ytResult');
    result.classList.add('hidden');

    if (!url) return toast('Enter a YouTube URL', 'error');
    if (!/^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/i.test(url)) {
      return toast('That doesn\'t look like a YouTube URL', 'error');
    }

    analytics.trackToolStart(toolId);

    if (!backend) {
      status.classList.remove('hidden');
      statusText.textContent = 'No backend configured';
      result.classList.remove('hidden');
      result.innerHTML = `
        <div class="format-note" style="border-left-color:var(--danger);background:#fee2e2;color:#7f1d1d">
          <b>No backend configured.</b> Open the "Backend configuration" section above and provide a URL. See the note below for why this is required.
        </div>
        <p class="muted" style="margin-top:12px;line-height:1.6">
          GitHub Pages is static — it cannot run a server-side downloader. To make this work you need to deploy a small helper
          (e.g. a cobalt instance) on a free platform (Cloudflare Workers, Deno Deploy, or any host you already use).
          Once deployed, paste its URL above and it will work everywhere this page loads.
        </p>`;
      return;
    }

    status.classList.remove('hidden');
    statusText.textContent = 'Contacting backend…';

    try {
      const apiUrl = backend + (backend.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url);
      const res = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('Backend returned ' + res.status);
      const data = await res.json();
      const directUrl = data.url || data.download_url || (data.picker && data.picker[0] && data.picker[0].url);
      if (!directUrl) throw new Error('Backend did not return a video URL');

      statusText.textContent = 'Ready';
      result.classList.remove('hidden');
      result.innerHTML = `
        <div class="video-preview">
          <video controls src="${directUrl}" style="width:100%;border-radius:12px;background:#000"></video>
          <div class="actions" style="margin-top:12px">
            <a class="btn btn-primary" href="${directUrl}" download>${icon('download', 16)} Download</a>
          </div>
        </div>`;
      analytics.trackToolComplete(toolId);
      toast('Ready', 'success');
    } catch (err) {
      console.error(err);
      analytics.trackError(toolId, err);
      statusText.textContent = 'Backend request failed';
      result.classList.remove('hidden');
      result.innerHTML = `<div class="format-note" style="border-left-color:var(--danger);background:#fee2e2;color:#7f1d1d">
        <b>Could not reach backend.</b> ${escapeHtmlMsg(err.message)}. Check the URL, CORS headers, and that the endpoint is publicly reachable.
      </div>`;
    }
  });
}
function escapeHtmlMsg(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

export const VIDEO_TOOLS = {
  'mp4-to-webm':        { name: 'MP4 → WebM',        render: renderMp4ToWebm },
  'youtube-downloader': { name: 'YouTube Downloader', render: renderYoutubeDownloader },
};