# MAX PAY — Local 1:1 Landing Page Reconstruction

Standalone, framework-free reconstruction of the public marketing page at
https://effulgent-fairy-1023a9.netlify.app/

This project is **independent** of the existing MaxPayDesign React/Vite/Tailwind
application in the parent folder. It shares no dependencies, config, or source
files with it.

## What this is

`index.html` is a direct, byte-for-byte copy of the captured live source
(`../reference/source/index.html`) — the same file size (78,077 bytes) confirms
an exact match. It is a single self-contained static HTML file:

- All CSS is inline in `<head><style>`.
- All JS is inline in one `<script>` block before `</body>`.
- No build step, no bundler, no framework, no backend.
- The only external network calls are to Google Fonts (Manrope, Saira Condensed,
  JetBrains Mono) — identical to the live site.

`assets/logo.svg` is the MAX PAY brand mark extracted for convenience/reuse. It
is **not** referenced by `index.html` — the page keeps its 5 inline copies of the
logo, exactly as the original does, to avoid introducing any path/loading
behavior the original doesn't have.

## Content placeholders — intentionally preserved

The original site ships with unfilled placeholders (`[PAYMENT METHODS — CONFIRM
WITH OPS]`, `[RBI AUTHORIZATION — IF APPLICABLE]`, `[SUPPORT EMAIL]`,
`[COMMERCIAL TERMS]`, etc.) and a footer disclaimer that all figures/transactions
are illustrative demo data. **These are kept as-is.** Do not fill them in until
a later phase with verified business information.

## No backend

Phase 1 confirmed the live site makes zero XHR/fetch/WebSocket calls and has no
API. This reconstruction matches that: the "live" transaction feed and payment
status animation are client-side `setInterval` loops over hardcoded demo data,
exactly as in the original. No backend, mock server, or API scaffolding has been
added.

## Running locally

No install/build step is required — it's a static file. Any of the following work:

```bash
# Option A — Node (no install needed, ships with npx)
npx serve . -l 5173

# Option B — Python
python -m http.server 5173

# Option C — just open the file directly
# (double-click index.html, or open it in a browser)
```

Then visit: **http://localhost:5173/**

## QA

See `qa/` for the visual-parity screenshots and comparison notes captured
against the Phase 1 live reference screenshots (`../reference/desktop`,
`../reference/tablet`, `../reference/mobile`).
