// content script: listens for color messages and applies to the page
// timing constants (tweakable)
const CLICK_SCROLL_DELAY_MS = 400; // wait after scrolling into view before showing marker and clicking
const MARKER_REMOVE_MS = 700; // marker animation length before removal
const POST_CLICK_CHECK_MS = 1200; // check if click changed page
const GLOBAL_RELOAD_MS = 900; // delay before global reload check after clicks

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'set-page-palette') {
      const palette = message.palette;
      const p = palette.colors || [];
      const font = palette.font || 'Arial, sans-serif';

      function hexToLuminance(hex) {
        if (!hex) return 0;
        const h = hex.replace('#', '').padEnd(6, '0');
        const r = parseInt(h.substring(0,2),16) / 255;
        const g = parseInt(h.substring(2,4),16) / 255;
        const b = parseInt(h.substring(4,6),16) / 255;
        const srgb = [r,g,b].map(c => (c <= 0.03928) ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4));
        return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
      }

      function contrastRatio(hex1, hex2) {
        const l1 = hexToLuminance(hex1);
        const l2 = hexToLuminance(hex2);
        const hi = Math.max(l1,l2);
        const lo = Math.min(l1,l2);
        return (hi + 0.05) / (lo + 0.05);
      }

      const bg = p[0] || '#0b0b0b';
      const preferText = p[1] || '#ffffff';
      let textColor = preferText;
      try {
        if (contrastRatio(bg, preferText) < 4.5) {
          const crWhite = contrastRatio(bg, '#ffffff');
          const crBlack = contrastRatio(bg, '#000000');
          textColor = crWhite >= crBlack ? '#ffffff' : '#000000';
        }
      } catch (e) {
        textColor = '#ffffff';
      }

      const normalized = [p[0]||'#0b0b0b', p[1]||textColor, p[2]||p[1]||'#1a73e8', p[3]||p[2]||'#444', p[4]||p[1]||'#888', p[5]||p[0]||'#111', p[6]||p[0]||'#222'];

      const style = document.createElement('style');
      style.id = id;
      style.textContent = `:root { --ext-1: ${normalized[0]}; --ext-2: ${normalized[1]}; --ext-3: ${normalized[2]}; --ext-4: ${normalized[3]}; --ext-5: ${normalized[4]}; --ext-6: ${normalized[5]}; --ext-7: ${normalized[6]}; --ext-text: ${textColor}; --ext-font: ${font}; }

        /* Default: apply palette to all elements */
        * {
          background-color: var(--ext-1) !important;
          color: var(--ext-text) !important;
          font-family: var(--ext-font) !important;
          background-image: none !important;
          box-shadow: none !important;
          text-shadow: none !important;
          border-color: var(--ext-3) !important;
        }

        /* Targeted relaxations: preserve original styling for specific elements */
        /* Allow iframes and embeds to keep their original styles (maps, videos, ads) */
        iframe, embed, object, [role="dialog"], [role="alertdialog"], .modal, .dialog {
          background-color: auto !important;
          color: auto !important;
          box-shadow: auto !important;
          border-color: auto !important;
        }
        iframe *, embed *, object *, [role="dialog"] *, [role="alertdialog"] *, .modal *, .dialog * {
          background-color: auto !important;
          color: auto !important;
          box-shadow: auto !important;
          border-color: auto !important;
          background-image: auto !important;
        }

        /* Preserve SVG icon colors (status indicators, logos) */
        svg[class*="icon"], svg[class*="status"], svg[role="img"] {
          fill: auto !important;
          stroke: auto !important;
        }
        svg[class*="icon"] *, svg[class*="status"] *, svg[role="img"] * {
          fill: auto !important;
          stroke: auto !important;
        }

        /* Specific element overrides for clarity */
        body, html, main, section, article, header, nav, footer, aside, div, p, ul, ol, li, table, tr, td, th {
          background-color: var(--ext-1) !important;
          color: var(--ext-text) !important;
        }

        a, a * { color: var(--ext-3) !important; }
        /* Only override SVGs that aren't icons (preserve icon styling) */
        svg:not([class*="icon"]):not([class*="status"]):not([role="img"]) * { fill: var(--ext-3) !important; stroke: var(--ext-3) !important; }

        button, input[type=button], input[type=submit], .btn { background-color: var(--ext-4) !important; color: var(--ext-text) !important; border-color: var(--ext-3) !important; }
        input, textarea, select, option { background-color: var(--ext-7) !important; color: var(--ext-text) !important; border-color: var(--ext-3) !important; }

        h1,h2,h3,h4,h5,h6, strong, b { color: var(--ext-5) !important; }

        nav, header, footer { background-color: var(--ext-6) !important; color: var(--ext-text) !important; }

        /* Soften images instead of grayscaling: reduce saturation and blend */
        img, video, picture { filter: saturate(0.4) brightness(0.95) !important; opacity: 0.85 !important; mix-blend-mode: overlay !important; }

        /* Code blocks */
        pre, code, kbd, samp { background-color: var(--ext-7) !important; color: var(--ext-text) !important; }

        /* Ensure borders and outlines follow palette */
        *:not(iframe):not(embed):not(object):not([role="dialog"]):not([role="alertdialog"]):not(.modal):not(.dialog) { border-color: var(--ext-3) !important; }
        :focus { outline-color: var(--ext-4) !important; }

        /* Placeholder and caret */
        ::placeholder { color: rgba(255,255,255,0.7) !important; }
        textarea, input, [contenteditable] { caret-color: var(--ext-3) !important; }
      `;
      document.head.appendChild(style);
              marker.style.transform = 'translate(-50%, -50%) scale(1.6)';
              marker.style.opacity = '0.0';
            });

            // remove after animation
            setTimeout(() => {
              marker.remove();
            }, MARKER_REMOVE_MS);
          } catch (e) {
            // ignore marker errors
          }

          randomEl.click();

          // Notify background that we've performed the click — background will open the next page in the sequence.
          try {
            chrome.runtime.sendMessage({ type: 'auto_explore_done' }, () => {});
          } catch (e) { /* ignore */ }
        }, CLICK_SCROLL_DELAY_MS);
      } else {
        // No clickable elements found — signal background to continue sequence
        try {
          chrome.runtime.sendMessage({ type: 'auto_explore_done' }, () => {});
        } catch (e) { /* ignore */ }
      }
      sendResponse({ success: true });
    } catch (e) {
      console.error('auto-explore failed:', e);
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
