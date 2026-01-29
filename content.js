// content script: listens for color messages and applies to the page
// timing constants (tweakable)
const CLICK_SCROLL_DELAY_MS = 400; // wait after scrolling into view before showing marker and clicking
const MARKER_REMOVE_MS = 700; // marker animation length before removal
const POST_CLICK_CHECK_MS = 1200; // check if click changed page
const GLOBAL_RELOAD_MS = 900; // delay before global reload check after clicks

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'set-page-palette') {
    try {
      const palette = message.palette; // palette: { name, colors: [7 colors] }
      const id = 'ext-palette-style';
      const existing = document.getElementById(id);
      if (existing) existing.remove();

      const p = palette.colors;
      const style = document.createElement('style');
      style.id = id;
      style.textContent = `:root { --ext-1: ${p[0]}; --ext-2: ${p[1]}; --ext-3: ${p[2]}; --ext-4: ${p[3]}; --ext-5: ${p[4]}; --ext-6: ${p[5]}; --ext-7: ${p[6]}; }
        body { background-color: var(--ext-1) !important; color: var(--ext-2) !important; transition: background-color 220ms ease; }
        a { color: var(--ext-3) !important; }
        button, input[type=button], .btn { background-color: var(--ext-4) !important; color: var(--ext-2) !important; border-color: var(--ext-3) !important; }
        h1,h2,h3,h4,h5,h6 { color: var(--ext-5) !important; }
        nav, header, footer { background-color: var(--ext-6) !important; }
        `;
      document.head.appendChild(style);
      sendResponse({ success: true });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }
  
  if (message && message.action === 'auto-explore') {
    try {
      // Find all clickable elements: links, buttons, and interactive elements
      const clickables = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"], .btn'));
      
      // Filter out hidden/invisible elements and ads
      const visible = clickables.filter(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
      });
      
      if (visible.length > 0) {
        // Pick a random visible clickable element
        const randomEl = visible[Math.floor(Math.random() * visible.length)];
        console.log('Auto-clicking element:', randomEl.textContent || randomEl.className);
        
        // Scroll into view and click
        randomEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const preHref = location.href;
        const preNodeCount = document.body ? document.body.getElementsByTagName('*').length : 0;

        setTimeout(() => {
          // show a red marker at the click target to indicate the click
          try {
            const rect = randomEl.getBoundingClientRect();
            const marker = document.createElement('div');
            marker.setAttribute('aria-hidden', 'true');
            marker.style.position = 'fixed';
            marker.style.left = (rect.left + rect.width / 2) + 'px';
            marker.style.top = (rect.top + rect.height / 2) + 'px';
            marker.style.transform = 'translate(-50%, -50%) scale(0.1)';
            marker.style.width = '32px';
            marker.style.height = '32px';
            marker.style.borderRadius = '50%';
            marker.style.background = 'rgba(220,20,60,0.95)';
            marker.style.boxShadow = '0 6px 18px rgba(220,20,60,0.35)';
            marker.style.zIndex = 2147483647;
            marker.style.pointerEvents = 'none';
            marker.style.transition = 'transform 360ms cubic-bezier(.2,.9,.3,1), opacity 520ms ease-out';
            marker.style.opacity = '1';
            // optional icon inside
            marker.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:14px;color:white;">●</div>';
            document.documentElement.appendChild(marker);

            // trigger animation
            requestAnimationFrame(() => {
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
