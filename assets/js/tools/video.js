import { analytics } from '../analytics.js';
import { $, icon, toast, download, makeDropZone, fmtBytes } from '../utils.js';

/* ---------- FFmpeg loader (lazy) ---------- */
let _ffmpeg = null, _util = null;
let _ffmpegHandlersBound = false;

async function loadFFmpeg(onProgress) {
  if (!_ffmpeg) {
    const [{ FFmpeg }, util] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm'),
      import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm'),
    ]);
    _ffmpeg = new FFmpeg();
    _util = util;
    const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
    await _ffmpeg.load({
      coreURL: await util.toBlobURL(base + '/ffmpeg-core.js', 'text/javascript'),
      wasmURL: await util.toBlobURL(base + '/ffmpeg-core.wasm', 'application/wasm'),
    });
  }
  if (onProgress && !_ffmpegHandlersBound) {
    _ffmpeg.on('progress', ({ progress }) => window.__vt_onProgress && window.__vt_onProgress(progress));
    _ffmpegHandlersBound = true;
  }
  return { ffmpeg: _ffmpeg, util: _util };
}

/* ---------- Shared runner ---------- */
async function runConvert({ root, toolId, file, args, outputName, outputExt, mime }) {
  const bar = root.querySelector('#vtBar');
  const pct = root.querySelector('#vtPct');
  const status = root.querySelector('#vtStatus');
  const dl = root.querySelector('#vtDownload');

  bar.style.width = '0%';
  pct.textContent = '0%';
  status.textContent = 'Loading FFmpeg (first run downloads ~30 MB)…';
  dl.classList.add('hidden');
  dl.disabled = true;
  analytics.trackToolStart(toolId);

  window.__vt_onProgress = (p) => {
    const v = Math.max(0, Math.min(99, Math.round(p * 100)));
    bar.style.width = v + '%';
    pct.textContent = v + '%';
  };

  const heartbeat = setInterval(() => {
    if (pct.textContent !== '100%' && pct.textContent !== '0%') {
      status.textContent = 'Encoding… ' + pct.textContent + ' (this can take a while)';
    }
  }, 3000);

  let inputMountDir = null;
  let inputFileName = null;

  try {
    const { ffmpeg, util } = await loadFFmpeg(true);

    // ---- Mount the file via WORKERFS (no memory copy) ----
    inputMountDir = '/input';
    inputFileName = file.name;
    const inputPath = `${inputMountDir}/${inputFileName}`;

    status.textContent = 'Mounting file…';
    await ffmpeg.createDir(inputMountDir);
    await ffmpeg.mount('WORKERFS', { files: [file] }, inputMountDir);

    status.textContent = 'Encoding (this can take a while)…';

    // Output still goes to MEMFS — but we stream it out in chunks below
    const outName = 'output.' + outputExt;
    const fullArgs = args(inputPath, outName);
    await ffmpeg.exec(fullArgs);

    status.textContent = 'Reading output…';

    // ---- Stream the output in chunks (avoids a second full copy) ----
    const chunks = [];
    const fileStream = await ffmpeg.readFile(outName);
    // readFile returns a Uint8Array; chunk it manually to avoid huge Blob construction
    const CHUNK = 4 * 1024 * 1024;
    for (let i = 0; i < fileStream.length; i += CHUNK) {
      chunks.push(fileStream.subarray(i, Math.min(i + CHUNK, fileStream.length)));
    }
    const blob = new Blob(chunks, { type: mime });

    clearInterval(heartbeat);
    bar.style.width = '100%';
    pct.textContent = '100%';
    status.textContent = 'Done — ' + (blob.size / 1048576).toFixed(1) + ' MB';
    dl.classList.remove('hidden');
    dl.disabled = false;
    dl.onclick = () => {
      download(blob, outputName(file.name));
      analytics.trackToolDownload(toolId);
    };

    analytics.trackToolComplete(toolId);
    toast('Ready', 'success');

    // Cleanup
    await ffmpeg.deleteFile(outName).catch(() => {});
  } catch (e) {
    clearInterval(heartbeat);
    console.error(e);
    analytics.trackError(toolId, e);
    status.textContent = 'Failed';
    const msg = String((e && e.message) || e);
    if (msg.toLowerCase().includes('memory') || msg.toLowerCase().includes('abort')) {
      toast('Out of memory. Try a smaller file or close other tabs.', 'error', 8000);
    } else {
      toast('Conversion failed — see console', 'error', 6000);
    }
  } finally {
    clearInterval(heartbeat);
    if (inputMountDir) {
      try { await ffmpeg.unmount(inputMountDir); } catch {}
      try { await ffmpeg.deleteDir(inputMountDir); } catch {}
    }
    window.__vt_onProgress = null;
  }
}

/* ---------- Base shell ---------- */
function buildShell(root, { note, title, hint, accept, extraHTML }) {
  root.innerHTML = `<div class="panel">
    <div class="format-note">${note || '<b>Browser-based.</b> First run downloads ~30 MB. Runs entirely on your device — expect slow encoding for HD video.'}</div>
    ${extraHTML || ''}
    <div id="vtDrop"></div>
    <div id="vtWorkspace" class="hidden" style="margin-top:20px">
      <div class="status-row"><span class="label" id="vtStatus">Preparing…</span><span class="pct" id="vtPct">0%</span></div>
      <div class="progress"><div id="vtBar"></div></div>
      <div class="actions">
        <button id="vtDownload" class="btn btn-primary hidden" disabled>${icon('download', 16)} Download</button>
      </div>
    </div>
  </div>`;
  const drop = makeDropZone({
    accept, multiple: false, title, hint,
    onFiles: (files) => root._onFile && root._onFile(files[0]),
  });
  root.querySelector('#vtDrop').appendChild(drop);
}

/* ---------- MP4 → WebM ---------- */
function renderMp4ToWebm(root, toolId) {
  buildShell(root, {
    title: 'Drop an MP4 video',
    hint: 'Converted to WebM locally',
    accept: 'video/mp4,video/*',
  });
  root._onFile = (file) => {
    root.querySelector('#vtWorkspace').classList.remove('hidden');
    runConvert({
      root, toolId, file,
      args: (i, o) => ['-i', i, '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus', '-b:a', '96k', o],
      outputExt: 'webm',
      mime: 'video/webm',
      outputName: (n) => n.replace(/\.[^.]+$/, '') + '.webm',
    });
  };
}

/* ---------- WebM → MP4 ---------- */
function renderWebmToMp4(root, toolId) {
  buildShell(root, {
    title: 'Drop a WebM video',
    hint: 'Converted to MP4 locally',
    accept: 'video/webm,video/*',
  });
  root._onFile = (file) => {
    root.querySelector('#vtWorkspace').classList.remove('hidden');
    runConvert({
      root, toolId, file,
      args: (i, o) => ['-i', i, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-c:a', 'aac', '-b:a', '128k', o],
      outputExt: 'mp4',
      mime: 'video/mp4',
      outputName: (n) => n.replace(/\.[^.]+$/, '') + '.mp4',
    });
  };
}

/* ---------- Video compress ---------- */
function renderVideoCompress(root, toolId) {
  buildShell(root, {
    title: 'Drop a video to compress',
    hint: 'Reduces bitrate — output is WebM',
    accept: 'video/*',
    extraHTML: `<div class="field-group">
      <div class="field"><label>Quality</label>
        <select id="vcQ"><option value="28">High quality</option><option value="32" selected>Balanced</option><option value="38">Small file</option></select>
      </div>
    </div>`,
  });
  root._onFile = (file) => {
    root.querySelector('#vtWorkspace').classList.remove('hidden');
    runConvert({
      root, toolId, file,
      args: (i, o) => ['-i', i, '-c:v', 'libvpx-vp9', '-crf', root.querySelector('#vcQ').value, '-b:v', '0', '-c:a', 'libopus', o],
      outputExt: 'webm',
      mime: 'video/webm',
      outputName: (n) => n.replace(/\.[^.]+$/, '') + '_compressed.webm',
    });
  };
}

/* ---------- Video → GIF ---------- */
function renderVideoToGif(root, toolId) {
  buildShell(root, {
    title: 'Drop a video',
    hint: 'Short clips work best — GIFs are large',
    accept: 'video/*',
    extraHTML: `<div class="field-group">
      <div class="field"><label>FPS</label><input type="number" id="vgFps" value="10" min="5" max="30"/></div>
      <div class="field"><label>Width (px)</label><input type="number" id="vgW" value="480" min="120" max="1280"/></div>
    </div>`,
  });
  root._onFile = (file) => {
    root.querySelector('#vtWorkspace').classList.remove('hidden');
    runConvert({
      root, toolId, file,
      args: (i, o) => ['-i', i, '-vf', `fps=${root.querySelector('#vgFps').value},scale=${root.querySelector('#vgW').value}:-1:flags=lanczos`, '-loop', '0', o],
      outputExt: 'gif',
      mime: 'image/gif',
      outputName: (n) => n.replace(/\.[^.]+$/, '') + '.gif',
    });
  };
}

/* ---------- Video → MP3 ---------- */
function renderVideoToMp3(root, toolId) {
  buildShell(root, {
    title: 'Drop a video',
    hint: 'Extracts the audio track as MP3',
    accept: 'video/*',
  });
  root._onFile = (file) => {
    root.querySelector('#vtWorkspace').classList.remove('hidden');
    runConvert({
      root, toolId, file,
      args: (i, o) => ['-i', i, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', o],
      outputExt: 'mp3',
      mime: 'audio/mpeg',
      outputName: (n) => n.replace(/\.[^.]+$/, '') + '.mp3',
    });
  };
}

/* ---------- Trim ---------- */
function renderVideoTrim(root, toolId) {
  buildShell(root, {
    title: 'Drop a video to trim',
    hint: 'Cut by start/end time',
    accept: 'video/*',
    extraHTML: `<div class="field-group">
      <div class="field"><label>Start (seconds)</label><input type="number" id="vtStart" value="0" min="0" step="0.1"/></div>
      <div class="field"><label>End (seconds)</label><input type="number" id="vtEnd" min="0" step="0.1"/></div>
    </div>`,
  });
  root._onFile = (file) => {
    root.querySelector('#vtWorkspace').classList.remove('hidden');
    runConvert({
      root, toolId, file,
      args: (i, o) => {
        const a = ['-i', i];
        const s = root.querySelector('#vtStart').value;
        const e = root.querySelector('#vtEnd').value;
        if (s) a.push('-ss', s);
        if (e) a.push('-to', e);
        return a.concat(['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', o]);
      },
      outputExt: 'mp4',
      mime: 'video/mp4',
      outputName: (n) => n.replace(/\.[^.]+$/, '') + '_trimmed.mp4',
    });
  };
}

/* ---------- Resize ---------- */
function renderVideoResize(root, toolId) {
  buildShell(root, {
    title: 'Drop a video to resize',
    hint: 'Scale to a target width',
    accept: 'video/*',
    extraHTML: `<div class="field-group">
      <div class="field"><label>Width (px)</label><input type="number" id="vrW" value="720" min="120" max="3840"/></div>
    </div>`,
  });
  root._onFile = (file) => {
    root.querySelector('#vtWorkspace').classList.remove('hidden');
    runConvert({
      root, toolId, file,
      args: (i, o) => ['-i', i, '-vf', `scale=${root.querySelector('#vrW').value}:-2`, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'copy', o],
      outputExt: 'mp4',
      mime: 'video/mp4',
      outputName: (n) => n.replace(/\.[^.]+$/, '') + '_resized.mp4',
    });
  };
}

/* ---------- Change FPS ---------- */
function renderChangeFps(root, toolId) {
  buildShell(root, {
    title: 'Drop a video to change frame rate',
    hint: 'Resamples the video to a new FPS',
    accept: 'video/*',
    extraHTML: `<div class="field-group">
      <div class="field"><label>FPS</label><input type="number" id="vfFps" value="24" min="5" max="120"/></div>
    </div>`,
  });
  root._onFile = (file) => {
    root.querySelector('#vtWorkspace').classList.remove('hidden');
    runConvert({
      root, toolId, file,
      args: (i, o) => ['-i', i, '-r', root.querySelector('#vfFps').value, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'copy', o],
      outputExt: 'mp4',
      mime: 'video/mp4',
      outputName: (n) => n.replace(/\.[^.]+$/, '') + '_fps.mp4',
    });
  };
}

/* ---------- Extract frames (no FFmpeg — pure canvas) ---------- */
function renderExtractFrames(root, toolId) {
  let video = null;
  let frames = [];

  root.innerHTML = `<div class="panel">
    <div class="format-note"><b>Fast:</b> Runs without FFmpeg — pulls frames directly from a video element.</div>
    <div id="efDrop"></div>
    <div id="efWorkspace" class="hidden" style="margin-top:20px">
      <div class="field-group">
        <div class="field"><label>Frames to extract</label><input type="number" id="efCount" value="10" min="1" max="100"/></div>
        <button id="efGo" class="btn btn-primary">Extract frames</button>
        <button id="efZip" class="btn btn-outline hidden" disabled>${icon('archive', 16)} Download ZIP</button>
      </div>
      <div id="efGrid" class="thumb-grid"></div>
    </div>
  </div>`;

  root.querySelector('#efDrop').appendChild(makeDropZone({
    accept: 'video/*', multiple: false,
    title: 'Drop a video',
    hint: 'Frames are evenly sampled across the clip',
    onFiles: async ([f]) => {
      const url = URL.createObjectURL(f);
      video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.preload = 'auto';
      await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
      root.querySelector('#efWorkspace').classList.remove('hidden');
      analytics.trackToolStart(toolId);
    },
  }));

  root.querySelector('#efGo').addEventListener('click', async () => {
    if (!video || !video.duration) return toast('Drop a video first', 'error');
    const n = Math.max(1, Math.min(100, +root.querySelector('#efCount').value));
    const dur = video.duration;
    const grid = root.querySelector('#efGrid');
    grid.innerHTML = '';
    frames = [];

    for (let i = 0; i < n; i++) {
      const t = (dur * i) / n;
      await seekTo(video, t);
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      frames.push({ name: `frame-${String(i + 1).padStart(3, '0')}.png`, blob });
      const url = URL.createObjectURL(blob);
      const div = document.createElement('div');
      div.className = 'thumb';
      div.innerHTML = `<img src="${url}"/><div class="done">${i + 1}</div>`;
      grid.appendChild(div);
    }
    root.querySelector('#efZip').classList.remove('hidden');
    root.querySelector('#efZip').disabled = false;
    analytics.trackToolComplete(toolId);
    toast(`Extracted ${n} frames`, 'success');
  });

  root.querySelector('#efZip').addEventListener('click', async () => {
    if (!frames.length) return;
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    const zip = new JSZip();
    frames.forEach((f) => zip.file(f.name, f.blob));
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, 'video-frames.zip');
    analytics.trackToolDownload(toolId);
  });
}

function seekTo(video, time) {
  return new Promise((resolve) => {
    const handler = () => {
      video.removeEventListener('seeked', handler);
      resolve();
    };
    video.addEventListener('seeked', handler);
    video.currentTime = time;
  });
}

/* ---------- Export ---------- */
export const VIDEO_TOOLS = {
  'mp4-to-webm':    { name: 'MP4 → WebM',      render: renderMp4ToWebm },
  'webm-to-mp4':    { name: 'WebM → MP4',      render: renderWebmToMp4 },
  'compress':       { name: 'Compress',        render: renderVideoCompress },
  'to-gif':         { name: 'Video → GIF',     render: renderVideoToGif },
  'to-mp3':         { name: 'Video → MP3',     render: renderVideoToMp3 },
  'trim':           { name: 'Trim',            render: renderVideoTrim },
  'resize':         { name: 'Resize',          render: renderVideoResize },
  'change-fps':     { name: 'Change FPS',      render: renderChangeFps },
  'extract-frames': { name: 'Extract Frames',  render: renderExtractFrames },
};