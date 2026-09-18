## Tools

🖼️ Image Tools
Background Remover — AI-powered background removal using @imgly/background-removal (WASM). Outputs transparent PNG.

Compressor — Reduce image file size with adjustable quality and format.

Resizer — Custom pixel dimensions with aspect-ratio lock. Batch processing.

Converter — PNG ↔ JPEG ↔ WebP. Batch processing.

SVG → Image — Rasterize SVG files to PNG, JPEG, or WebP at any resolution with live preview.

Social Media Resizer — Interactive crop (Cropper.js) with 14 platform presets: Facebook Post/Cover/Story, Instagram Post/Portrait/Story, TikTok, YouTube Thumbnail/Shorts, LinkedIn Post/Banner, X/Twitter Post, Pinterest Pin.

QR Generator — Custom colors, size, and download. Generates QR codes for any URL or text.

📄 PDF & Documents
Creator — Combine images, TXT, HTML, and DOCX into a single PDF. Drag to reorder. (jsPDF + html2canvas + mammoth)

Merge — Combine multiple PDFs with drag-to-reorder. (pdf-lib)

Split — Split by page ranges or extract every page as an individual PDF. Download individually or as ZIP.

Reorder Pages — Visual page thumbnails with drag-and-drop reordering.

Rotate Pages — Rotate all or specific pages by 90° / 180° / 270°.

Compress — Rasterize pages at reduced DPI and quality to shrink file size. Shows before/after size comparison.

PDF → Image — Render every page to PNG or JPEG. Downloads as ZIP.

PDF → Word — Extract text to .docx. Text-only; layout is not preserved.

Compare — Side-by-side page render with per-page percentage difference. (pdfjs-dist)

Redact — Draw black boxes on any page. Pages are rasterized on export, so redacted content is truly removed, not just covered.

Password Protect — AES encryption with printing and copying permission controls. (@cantoo/pdf-lib)

Unlock — Remove password protection from a PDF (requires the current password).

Sign — Draw or upload a signature, place it on any page, drag to reposition. Exports a signed PDF.

🎥 Video Tools
All video processing uses @ffmpeg/ffmpeg (WASM) and runs entirely on your device. Conversion is single-threaded and CPU-bound — a 30-second 720p clip takes 2–5 minutes. Longer clips may fail on low-RAM devices. Warnings are shown in the UI.

MP4 → WebM — Convert MP4 to WebM (VP9 + Opus).

WebM → MP4 — Convert WebM to MP4 (H.264 + AAC).

Compress — Reduce bitrate and resolution with quality presets.

Video → GIF — Convert short clips to animated GIF. FPS and width configurable.

Video → MP3 — Extract audio track as MP3 (192 kbps).

Trim — Cut by start/end time.

Resize — Scale to a target width, preserving aspect ratio.

Change FPS — Resample video to a new frame rate.

Extract Frames — Pull N evenly-spaced frames as PNGs. Runs without FFmpeg (uses a <video> element + Canvas).

🔗 URL & Web
URL Encode/Decode — encodeURIComponent / decodeURIComponent.

Base64 — Encode and decode UTF-8-safe Base64.

HTML Entities — Encode and decode &amp;, &lt;, &gt;, &quot;, &#39;.

UTM Builder — Generate campaign URLs with utm_source, utm_medium, utm_campaign, utm_term, utm_content.

Favicon Generator — Emoji or short text → PNG favicon at 32/64/128/180/512 px.

Meta Tag Generator — Generate <meta> and Open Graph tags for SEO and social preview.

Password Generator — Cryptographically secure passwords via crypto.getRandomValues(). Length and character set controls.

📝 Text Tools
Word Count — Words, characters, characters without spaces, sentences, paragraphs, reading time.

Case Converter — UPPERCASE, lowercase, Title Case, Sentence case, camelCase, snake_case, kebab-case.

Line Cleaner — Remove duplicate lines, extra spaces, blank lines; trim; sort A→Z or Z→A; reverse; number lines.

Find & Replace — Plain text or regex, case-sensitive toggle.

Text → PDF — Multi-page PDF with configurable font size and optional title.

JSON Formatter — Pretty-print (2-space), minify, or validate with error messages.

JSON ↔ CSV — Convert between a JSON array of objects and CSV (RFC 4180 compliant parser).

Markdown ↔ HTML — Bidirectional conversion with rendered preview.

🎨 Color Tools
Color Picker — Sample any pixel from an uploaded image. Returns HEX, RGB, HSL. Click-to-copy.

Color Converter — Live HEX ↔ RGB ↔ HSL conversion with a full-size swatch preview.

Palette Generator — Generate color harmonies: analogous, complementary, triadic, tetradic, monochromatic, and shades. Click a swatch to copy.

Contrast Checker — WCAG contrast ratio with AA Large, AA Normal, and AAA pass/fail indicators.

💰 Calculators
Percentage — "A% of B", "A is what % of B", "% change A→B", "B ± A%".

Discount — Original price, discount %, optional tax → final price and total savings.

VAT / Tax — Net ↔ Gross conversion with tax breakdown.

Loan — Monthly payment, total paid, total interest, plus a 12-month amortization preview.

Salary / Hourly — Convert between hourly, daily, weekly, monthly, and yearly rates.

Unit Converter — Length, weight, area, volume, speed, and digital storage.

Age — Age in years/months/days plus total days, weeks, and hours.

Date Difference — Days, weekdays, weeks, months, years, and hours between two dates.

Time Zone — Convert one wall-clock time to 21 major timezones with offset display.

💼 Business
Invoice Generator — Full invoice editor with:

Business logo upload

Hand-drawn or uploaded signature

Client and business address blocks

Line items with per-item tax rates

Flat or percentage discounts, shipping

Payment terms and payment details

Live PDF-accurate preview that updates on every keystroke

Saved invoice history (localStorage) with edit, duplicate, delete

Revenue reports — 12-month bar chart, invoice count by status, top clients

PDF export with logo, signature, meta strip, striped items table, and totals

Architecture note
Every tool runs entirely in your browser. There is no backend, no database, and no server-side processing.

Files never leave your device. Open DevTools → Network tab and verify for yourself.

Heavy dependencies load lazily only when you open the tool that needs them, so the initial page load stays fast.

Where storage is used, it's browser-local (localStorage for the Invoice Generator) and never transmitted.

Analytics (optional) uses GoatCounter for anonymous, cookieless event counts only — tool opens, completions, and downloads. No file contents, no personal data.

What's not included (and why)
Rather than ship something that pretends to work, these tools are deliberately omitted:

YouTube Downloader — A static site cannot download YouTube videos. YouTube blocks cross-origin requests, and every pure-client approach either requires a third-party proxy or breaks when YouTube changes its API. Including it would mean shipping a fake UI or requiring you to run a backend. We chose neither.

URL Shortener — Requires a redirect server. Incompatible with static hosting.

Website Screenshot — Requires a headless browser (Puppeteer) on a server.

High-quality PDF → Word — Preserving layout requires LibreOffice or similar. We ship a text-only extraction instead, with a clear note in the UI.

Currency Converter — Requires a live exchange-rate API key. Every free tier either rate-limits aggressively or requires key rotation, which adds complexity we chose to avoid.

All processing is done with modern browser APIs: Canvas 2D, WebAssembly, crypto.subtle, FileReader, and Intl. If a browser doesn't support these, the affected tool degrades gracefully with an error message rather than crashing the page.
