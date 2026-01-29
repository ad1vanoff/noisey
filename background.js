// background service worker for simple defaults
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['colorWidgetState'], (res) => {
    if (!res.colorWidgetState) {
      chrome.storage.sync.set({ colorWidgetState: { index: 0, applyToPage: false } });
    }
  });
});

// simple message handler (logging) — can be extended
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'log') {
    console.log('BG:', msg.message);
  }
});
