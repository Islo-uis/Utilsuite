## Tools

### Image Tools
- **Background Remover** — AI background removal (`@imgly/background-removal`, WASM)
- **Compressor** — Reduce image file size with quality control
- **Resizer** — Custom pixel dimensions, aspect-ratio lock
- **Converter** — PNG ↔ JPEG ↔ WebP
- **Social Media Resizer** — Cropper.js + platform presets (Facebook, Instagram, TikTok, YouTube, LinkedIn, X, Pinterest)

### PDF Tools
- **Creator** — Images, TXT, HTML, DOCX → PDF (via jsPDF + html2canvas + mammoth)
- **Merge** — Combine multiple PDFs (pdf-lib)
- **Split** — Ranges or per-page output (pdf-lib)
- **Compare** — Side-by-side page render with % difference (pdfjs-dist)
- **Redact** — Draw black boxes; pages are rasterized so content is truly removed (pdfjs-dist + pdf-lib)
- **Password** — AES encryption with permissions (`@cantoo/pdf-lib`)
- **Sign** — Draw or upload signature, place on any page (pdfjs-dist + pdf-lib)

### Video Tools
- **MP4 → WebM** — In-browser conversion via `@ffmpeg/ffmpeg` (WASM, single-threaded). Slow but fully local.
- **YouTube Downloader** — **Requires your own backend.** See below.

## YouTube Downloader limitation

GitHub Pages is static hosting and cannot download YouTube videos. YouTube blocks cross-origin browser requests, and every purely client-side approach is unreliable. The tool ships with a UI and a configurable backend URL. You must deploy your own CORS-enabled resolver — for example a self-hosted [cobalt](https://github.com/imputnet/cobalt) instance or a yt-dlp serverless wrapper. Once configured, paste the URL into the tool and it works everywhere the page loads. No credentials are stored in this repo.

## Google Drive

Removed. The project no longer uses Google Drive, Google OAuth, or any external cloud-storage dependency. All processing is local.