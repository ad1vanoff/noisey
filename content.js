// content script: listens for color messages and applies to the page
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
        setTimeout(() => {
          randomEl.click();
          
          // After a delay, load the next random website
          setTimeout(() => {
            const websites = message.websites;
            const nextUrl = websites[Math.floor(Math.random() * websites.length)];
            window.location.href = nextUrl;
          }, 1500);
        }, 500);
      } else {
        // No clickable elements found, just load next site
        const websites = message.websites;
        const nextUrl = websites[Math.floor(Math.random() * websites.length)];
        window.location.href = nextUrl;
      }
      sendResponse({ success: true });
    } catch (e) {
      console.error('auto-explore failed:', e);
      sendResponse({ success: false, error: e.message });
    }
  }
  
  return true;
});
