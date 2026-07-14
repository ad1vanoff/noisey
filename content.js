// content script: listens for color messages and applies to the page
// timing constants (tweakable)
const CLICK_SCROLL_DELAY_MS = 400; // wait after scrolling into view before showing marker and clicking
const MARKER_REMOVE_MS = 700; // marker animation length before removal
const POST_CLICK_CHECK_MS = 1200; // check if click changed page
const GLOBAL_RELOAD_MS = 900; // delay before global reload check after clicks

// ===================== palette engine =====================
// Instead of painting every element the same color, classify each element by
// its ORIGINAL background (page bg / raised card / inverted section / accent
// button) and map each role to a derived shade of the palette. This keeps the
// page's visual hierarchy while theming it completely.

const NZ_STYLE_ID = 'ext-palette-style';
const NZ_ATTR = 'data-nz-s';
const NZ_MAX_ELEMENTS = 8000; // per-pass classification budget

// tags that should never be classified/painted directly
const NZ_SKIP = new Set([
  'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD',
  'IFRAME', 'EMBED', 'OBJECT', 'IMG', 'PICTURE', 'SOURCE', 'VIDEO', 'AUDIO',
  'CANVAS', 'TRACK', 'BR', 'WBR', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION',
  'CODE', 'PRE', 'KBD', 'SAMP' // always use the field colors, never a surface level
]);

let nzCtx = null;       // { baseL, baseIsLight, count } classification context
let nzCss = '';         // current generated stylesheet text
let nzObserver = null;
let nzShadowRoots = []; // shadow roots we've injected styles into

// ---------- color utilities ----------
function nzParseColor(str) {
  if (!str) return null;
  const m = str.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.%]+))?\s*\)/);
  if (!m) return null;
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (typeof m[4] === 'string' && m[4].includes('%')) a /= 100;
  return [+m[1], +m[2], +m[3], a];
}

function nzHexToRgb(hex) {
  if (!hex) return null;
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  h = h.padEnd(6, '0');
  return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
}

function nzRgbToHex(rgb) {
  return '#' + rgb.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function nzLum(rgb) {
  const s = rgb.slice(0, 3).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
}

function nzContrast(a, b) {
  const l1 = nzLum(a), l2 = nzLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// mix rgb array `a` toward rgb array `b` by fraction t
function nzMix(a, b, t) {
  return a.slice(0, 3).map((v, i) => v + (b[i] - v) * t);
}

// pick a readable text color for a background, preferring the palette's own
function nzTextOn(bgRgb, preferredRgb) {
  if (preferredRgb && nzContrast(bgRgb, preferredRgb) >= 4.5) return nzRgbToHex(preferredRgb);
  return nzContrast(bgRgb, [255, 255, 255]) >= nzContrast(bgRgb, [0, 0, 0]) ? '#ffffff' : '#000000';
}

// nudge a foreground color toward black/white until it reaches `min` contrast
function nzEnsureContrast(fgRgb, bgRgb, min) {
  let fg = fgRgb.slice(0, 3);
  const target = nzLum(bgRgb) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let i = 0; i < 12 && nzContrast(fg, bgRgb) < min; i++) {
    fg = nzMix(fg, target, 0.15);
  }
  return nzRgbToHex(fg);
}

// ---------- theme derivation ----------
// palette.colors roles: [0] page bg, [1] text, [2] links, [3] buttons/accent,
// [4] headings, [5] nav/header/footer, [6] inputs/code
function nzBuildTheme(palette) {
  const cols = (palette.colors || []).map(nzHexToRgb);
  const bg = cols[0] || [11, 11, 11];
  const textPref = cols[1] || [255, 255, 255];
  const text = nzHexToRgb(nzTextOn(bg, textPref));
  const accent = cols[3] || cols[2] || [68, 68, 68];
  const inv = cols[5] || nzMix(bg, text, 0.85);
  const field = cols[6] || nzMix(bg, text, 0.1);

  return {
    font: palette.font || 'Arial, sans-serif',
    bg: nzRgbToHex(bg),
    s1: nzRgbToHex(nzMix(bg, text, 0.06)),
    s2: nzRgbToHex(nzMix(bg, text, 0.13)),
    border: nzRgbToHex(nzMix(bg, text, 0.28)),
    text: nzRgbToHex(text),
    muted: nzRgbToHex(nzMix(text, bg, 0.4)),
    head: nzEnsureContrast(cols[4] || textPref, bg, 3),
    link: nzEnsureContrast(cols[2] || textPref, bg, 3),
    accent: nzRgbToHex(accent),
    accentText: nzTextOn(accent, text),
    inv: nzRgbToHex(inv),
    invText: nzTextOn(inv, textPref),
    field: nzRgbToHex(field),
    fieldText: nzTextOn(field, text)
  };
}

function nzBuildCss(t) {
  return `
:root {
  --nz-bg: ${t.bg}; --nz-s1: ${t.s1}; --nz-s2: ${t.s2}; --nz-border: ${t.border};
  --nz-text: ${t.text}; --nz-muted: ${t.muted}; --nz-head: ${t.head}; --nz-link: ${t.link};
  --nz-accent: ${t.accent}; --nz-accent-text: ${t.accentText};
  --nz-inv: ${t.inv}; --nz-inv-text: ${t.invText};
  --nz-field: ${t.field}; --nz-field-text: ${t.fieldText};
  --nz-font: ${t.font};
}

html, body { background-color: var(--nz-bg) !important; }

* {
  color: var(--nz-text) !important;
  border-color: var(--nz-border) !important;
  font-family: var(--nz-font) !important;
}

/* keep icon fonts (FontAwesome, Material Icons, ...) rendering as icons */
[data-nz-font-keep], [data-nz-font-keep] * { font-family: revert !important; }
pre, pre *, code, kbd, samp { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important; }

/* surface roles assigned during classification */
[${NZ_ATTR}] { background-image: none !important; box-shadow: none !important; text-shadow: none !important; }
[${NZ_ATTR}="0"] { background-color: var(--nz-bg) !important; }
[${NZ_ATTR}="1"] { background-color: var(--nz-s1) !important; }
[${NZ_ATTR}="2"] { background-color: var(--nz-s2) !important; }
[${NZ_ATTR}="inv"] { background-color: var(--nz-inv) !important; }
[${NZ_ATTR}="accent"] { background-color: var(--nz-accent) !important; border-color: var(--nz-accent) !important; }

h1, h2, h3, h4, h5, h6, strong, b { color: var(--nz-head) !important; }
a, a * { color: var(--nz-link) !important; }

/* text on inverted / accent surfaces stays readable */
[${NZ_ATTR}="inv"], [${NZ_ATTR}="inv"] * { color: var(--nz-inv-text) !important; }
[${NZ_ATTR}="accent"], [${NZ_ATTR}="accent"] * { color: var(--nz-accent-text) !important; }

input, textarea, select, option {
  background-color: var(--nz-field) !important;
  color: var(--nz-field-text) !important;
  border-color: var(--nz-border) !important;
}
pre, code, kbd, samp { background-color: var(--nz-field) !important; color: var(--nz-field-text) !important; }

img, video, picture { filter: saturate(0.8) !important; }

::selection { background: var(--nz-accent) !important; color: var(--nz-accent-text) !important; }
::placeholder { color: var(--nz-field-text) !important; opacity: 0.6 !important; }
:focus-visible { outline-color: var(--nz-link) !important; }
input, textarea, [contenteditable] { caret-color: var(--nz-link) !important; }
`;
}

// ---------- element classification ----------
function nzBaseLum() {
  let rgba = null;
  try {
    if (document.body) rgba = nzParseColor(getComputedStyle(document.body).backgroundColor);
    if (!rgba || rgba[3] === 0) rgba = nzParseColor(getComputedStyle(document.documentElement).backgroundColor);
  } catch (e) { /* ignore */ }
  if (!rgba || rgba[3] === 0) rgba = [255, 255, 255, 1]; // browsers default to white
  return nzLum(rgba);
}

function nzClassify(el) {
  if (!(el instanceof Element) || el instanceof SVGElement) return;
  if (NZ_SKIP.has(el.tagName) || el.id === NZ_STYLE_ID) return;

  let cs;
  try { cs = getComputedStyle(el); } catch (e) { return; }

  // preserve ligature/icon fonts before the global font override hits them
  if (/icon|glyph|awesome|symbols|emoji|brands/i.test(cs.fontFamily)) {
    el.setAttribute('data-nz-font-keep', '');
  }

  const rgba = nzParseColor(cs.backgroundColor);
  const alpha = rgba ? rgba[3] : 0;
  const hasGradient = (cs.backgroundImage || '').includes('gradient');

  // transparent, no gradient: nothing to paint — it shows its parent's surface
  if (alpha < 0.05 && !hasGradient) {
    if (el.hasAttribute(NZ_ATTR)) el.removeAttribute(NZ_ATTR);
    return;
  }

  // effective luminance (blend semi-transparent backgrounds with the page base)
  let L = nzCtx.baseL;
  if (rgba && alpha >= 0.05) {
    L = alpha * nzLum(rgba) + (1 - alpha) * nzCtx.baseL;
  }

  const delta = Math.abs(L - nzCtx.baseL);
  const sat = rgba ? (Math.max(...rgba.slice(0, 3)) - Math.min(...rgba.slice(0, 3))) / 255 : 0;
  let isInteractive = false;
  try {
    isInteractive = el.matches('button, [role="button"], [type="button"], [type="submit"], a[class*="btn" i], [class*="button" i]');
  } catch (e) { /* ignore */ }

  let level;
  if (isInteractive && (sat > 0.2 || delta > 0.15)) {
    level = 'accent'; // colored/contrasting call-to-action
  } else if (delta > 0.3 && ((nzCtx.baseIsLight && L < 0.35) || (!nzCtx.baseIsLight && L > 0.6))) {
    level = 'inv'; // opposite-polarity section (dark navbar on light page, etc.)
  } else if (delta < 0.04) {
    level = hasGradient ? '1' : '0'; // same as page bg (gradients read as slight elevation)
  } else if (delta < 0.15) {
    level = '1'; // raised card / panel
  } else {
    level = '2'; // strongly differentiated panel
  }
  el.setAttribute(NZ_ATTR, level);
}

function nzWalk(root) {
  let els;
  try { els = root.querySelectorAll('*'); } catch (e) { return; }
  for (const el of els) {
    if (++nzCtx.count > NZ_MAX_ELEMENTS) return;
    nzClassify(el);
    if (el.shadowRoot) nzStyleShadow(el.shadowRoot);
  }
}

// ---------- style injection (document + shadow roots) ----------
function nzInjectDocStyle() {
  let s = document.getElementById(NZ_STYLE_ID);
  if (!s) {
    s = document.createElement('style');
    s.id = NZ_STYLE_ID;
  }
  s.textContent = nzCss;
  // (re)appending keeps our sheet last so it wins ties in the cascade
  (document.head || document.documentElement).appendChild(s);
}

function nzStyleShadow(root) {
  if (!nzShadowRoots.includes(root)) nzShadowRoots.push(root);
  let s = root.querySelector('style.nz-shadow-style');
  if (!s) {
    s = document.createElement('style');
    s.className = 'nz-shadow-style';
    root.appendChild(s);
    s.textContent = nzCss;
    nzWalk(root); // classify shadow contents once styled
  } else if (s.textContent !== nzCss) {
    s.textContent = nzCss;
    nzWalk(root);
  }
}

// ---------- keep up with SPAs and dynamic content ----------
function nzObserve() {
  if (nzObserver) return;
  nzObserver = new MutationObserver((muts) => {
    if (!nzCss) return;
    // restore our sheet if the site removed it
    if (!document.getElementById(NZ_STYLE_ID)) nzInjectDocStyle();

    nzCtx.count = 0; // fresh budget per batch
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || n.id === NZ_STYLE_ID) continue;
        if (n instanceof SVGElement || NZ_SKIP.has(n.tagName)) continue;
        if (n.classList && n.classList.contains('nz-shadow-style')) continue;
        nzClassify(n);
        nzWalk(n);
        if (n.shadowRoot) nzStyleShadow(n.shadowRoot);
      }
    }
  });
  nzObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function applyPalette(palette) {
  // tear down any previous theme so classification sees the page's real styles
  const prev = document.getElementById(NZ_STYLE_ID);
  if (prev) prev.remove();
  for (const root of nzShadowRoots) {
    try {
      const s = root.querySelector('style.nz-shadow-style');
      if (s) s.remove();
    } catch (e) { /* ignore */ }
  }
  nzShadowRoots = [];

  const theme = nzBuildTheme(palette);
  nzCss = nzBuildCss(theme);

  nzCtx = { baseL: nzBaseLum(), count: 0 };
  nzCtx.baseIsLight = nzCtx.baseL > 0.5;

  nzWalk(document);   // classify against original styles first...
  nzInjectDocStyle(); // ...then paint
  nzObserve();
}

// ===================== read-only "passive browse" engine =====================
// SAFETY CONTRACT — READ BEFORE EDITING:
// This engine runs on sites the user is SIGNED IN to. To guarantee it can never
// emit an engagement/social signal (a like, follow, comment, share, react, DM,
// story view, read receipt, form submission, or ad click), it is only permitted
// to call window.scrollBy(). It must NOT, under any circumstances, gain code that
// clicks elements, dispatches pointer/mouse/keyboard events, focuses or types into
// fields, submits forms, or changes location/history. Variety (e.g. "search") is
// produced upstream by the background worker choosing which URL to OPEN — never by
// interacting with the page here. Scrolling only affects the user's own viewport;
// it consumes content the way a human reading the page does, and emits nothing.
const PASSIVE_MIN_MS = 8000;   // shortest read-only session
const PASSIVE_MAX_MS = 22000;  // longest read-only session

function passiveBrowse(done) {
  const duration = PASSIVE_MIN_MS + Math.random() * (PASSIVE_MAX_MS - PASSIVE_MIN_MS);
  const start = Date.now();
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    try { done(); } catch (e) { /* ignore */ }
  };

  const step = () => {
    if (finished) return;
    if (Date.now() - start >= duration) { finish(); return; }

    // The ONLY page interaction permitted in this engine: scrolling the viewport.
    const r = Math.random();
    try {
      if (r < 0.72) {
        window.scrollBy({ top: 180 + Math.random() * 520, behavior: 'smooth' }); // read onward
      } else if (r < 0.86) {
        window.scrollBy({ top: -(80 + Math.random() * 260), behavior: 'smooth' }); // glance back up
      }
      // remaining ~14%: dwell (no scroll) — simulates reading/pausing
    } catch (e) { /* ignore */ }

    setTimeout(step, 700 + Math.random() * 2800); // variable reading pause
  };

  // small initial settle before the first scroll
  setTimeout(step, 500 + Math.random() * 1200);
}

// ===================== message handling =====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'set-page-palette') {
    try {
      applyPalette(message.palette || {});
      sendResponse({ success: true });
    } catch (e) {
      console.error('set-page-palette failed:', e);
      sendResponse({ success: false, error: e.message });
    }

  } else if (message && message.action === 'auto-explore') {
    // only the top frame explores; iframes just theme themselves
    if (window !== window.top) return;
    try {
      const candidates = Array.from(document.querySelectorAll('a[href], button, [role="button"], input[type="button"], input[type="submit"]'))
        .filter(el => {
          try {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && !el.disabled && !el.hasAttribute('data-no-reload');
          } catch (e) { return false; }
        });

      const randomEl = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;

      if (randomEl) {
        randomEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

        setTimeout(() => {
          try {
            const rect = randomEl.getBoundingClientRect();
            const marker = document.createElement('div');
            marker.style.cssText = 'position:fixed;z-index:999999;width:32px;height:32px;border-radius:50%;background:rgba(255,80,80,0.7);pointer-events:none;transform:translate(-50%,-50%);transition:transform 0.3s,opacity 0.3s;';
            marker.style.left = (rect.left + rect.width / 2) + 'px';
            marker.style.top = (rect.top + rect.height / 2) + 'px';
            document.body.appendChild(marker);

            setTimeout(() => {
              marker.style.transform = 'translate(-50%, -50%) scale(1.6)';
              marker.style.opacity = '0.0';
            });

            setTimeout(() => {
              marker.remove();
            }, MARKER_REMOVE_MS);
          } catch (e) {
            // ignore marker errors
          }

          randomEl.click();

          try {
            chrome.storage.local.get(['closeTabCheck'], (result) => {
              chrome.runtime.sendMessage({ type: 'auto_explore_done', closeTab: !!result.closeTabCheck }, () => {});
            });
          } catch (e) { /* ignore */ }
        }, CLICK_SCROLL_DELAY_MS);
      } else {
        // No clickable elements found — signal background to continue sequence
        try {
          chrome.storage.local.get(['closeTabCheck'], (result) => {
            chrome.runtime.sendMessage({ type: 'auto_explore_done', closeTab: !!result.closeTabCheck }, () => {});
          });
        } catch (e) { /* ignore */ }
      }
      sendResponse({ success: true });
    } catch (e) {
      console.error('auto-explore failed:', e);
      sendResponse({ success: false, error: e.message });
    }

  } else if (message && message.action === 'passive-browse') {
    // read-only session for signed-in sites: scroll/dwell only, then signal done
    if (window !== window.top) return; // only the top frame drives the session
    try {
      passiveBrowse(() => {
        try {
          chrome.storage.local.get(['closeTabCheck'], (result) => {
            chrome.runtime.sendMessage({ type: 'passive_browse_done', closeTab: !!result.closeTabCheck }, () => {});
          });
        } catch (e) { /* ignore */ }
      });
      sendResponse({ success: true });
    } catch (e) {
      console.error('passive-browse failed:', e);
      sendResponse({ success: false, error: e.message });
    }
  }

  return true;
});

// Global safeguard: when a user (or script) clicks a button/anchor that doesn't appear
// to change the page, reload after a short delay so the UI reflects any side-effects.
// This helps when clicks do nothing due to SPA quirks or unresponsive elements.
document.addEventListener('click', (ev) => {
  try {
    if (window !== window.top) return; // don't reload embedded frames
    const el = ev.target.closest && ev.target.closest('a, button, [role="button"], input[type="button"], input[type="submit"], .btn');
    if (!el) return;

    // opt-out attribute for elements we shouldn't reload after
    if (el.hasAttribute && el.hasAttribute('data-no-reload')) return;

    const preHref = location.href;
    const preCount = document.body ? document.body.getElementsByTagName('*').length : 0;

    setTimeout(() => {
      try {
        if (location.href !== preHref) return; // navigation happened
        const postCount = document.body ? document.body.getElementsByTagName('*').length : 0;
        const diff = Math.abs(postCount - preCount);
        const threshold = Math.max(3, Math.floor(preCount * 0.01));
        if (diff <= threshold) {
          // nothing visibly changed — reload to force UI update
          location.reload();
        }
      } catch (e) { /* ignore */ }
    }, GLOBAL_RELOAD_MS);
  } catch (e) { /* ignore */ }
}, true);
