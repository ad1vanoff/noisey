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

// Sequence state storage keyed by sequence id
const sequences = {};

// Unregistered (failed) websites list persisted to storage
function markUnregistered(url) {
  chrome.storage.sync.get(['randomWebsitesUnregistered'], (res) => {
    const list = Array.isArray(res.randomWebsitesUnregistered) ? res.randomWebsitesUnregistered : [];
    if (!list.includes(url)) {
      list.push(url);
      chrome.storage.sync.set({ randomWebsitesUnregistered: list });
      console.warn('Marked unregistered:', url);
    }
  });
}

// Fetch trending URLs from HackerNews API
async function fetchTrendingUrls() {
  try {
    const resp = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const storyIds = await resp.json();
    const trending = [];
    
    // Fetch top 10-15 stories and extract URLs
    for (let i = 0; i < Math.min(15, storyIds.length); i++) {
      try {
        const storyResp = await fetch(`https://hacker-news.firebaseio.com/v0/item/${storyIds[i]}.json`);
        const story = await storyResp.json();
        if (story && story.url) {
          trending.push(story.url);
        }
      } catch (e) { /* ignore individual story errors */ }
    }
    
    return trending.length > 0 ? trending : null;
  } catch (e) {
    console.warn('Failed to fetch trending URLs:', e);
    return null;
  }
}

function openNextForSequence(seqId) {
  const seq = sequences[seqId];
  if (!seq) return;
  if (seq.remaining <= 0) {
    delete sequences[seqId];
    return;
  }

  const url = seq.websites[Math.floor(Math.random() * seq.websites.length)];
  chrome.tabs.create({ url }, (tab) => {
    if (!tab) return;
    seq.remaining -= 1;
    const tid = tab.id;
    // ensure trackers container exists
    seq.trackers = seq.trackers || {};
    seq.trackers[tid] = { url, timeoutId: null };

    // Always wait for the tab to finish loading so we can optionally apply palette
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tid && changeInfo.status === 'complete') {
        // remove listener
        chrome.tabs.onUpdated.removeListener(onUpdated);

        // If sequence requested applying a palette to new tabs, inject the CSS directly
        try {
          if (seq.applyThemeToNewTab && seq.palette) {
            // Use scripting.executeScript to inject a style element with the palette colors.
            try {
              chrome.scripting.executeScript({
                target: { tabId: tid },
                func: (colors) => {
                  try {
                    const id = 'ext-palette-style';
                    const existing = document.getElementById(id);
                    if (existing) existing.remove();
                    const style = document.createElement('style');
                    style.id = id;
                    style.textContent = `:root { --ext-1: ${colors[0]}; --ext-2: ${colors[1]}; --ext-3: ${colors[2]}; --ext-4: ${colors[3]}; --ext-5: ${colors[4]}; --ext-6: ${colors[5]}; --ext-7: ${colors[6]}; }\n                      body { background-color: var(--ext-1) !important; color: var(--ext-2) !important; transition: background-color 220ms ease; }\n                      a { color: var(--ext-3) !important; }\n                      button, input[type=button], .btn { background-color: var(--ext-4) !important; color: var(--ext-2) !important; border-color: var(--ext-3) !important; }\n                      h1,h2,h3,h4,h5,h6 { color: var(--ext-5) !important; }\n                      nav, header, footer { background-color: var(--ext-6) !important; }`;
                    (document.head || document.documentElement).appendChild(style);
                  } catch (e) {
                    // ignore
                  }
                },
                args: [seq.palette.colors]
              });
            } catch (e) {
              // fallback: try sending a message to content script
              try {
                chrome.tabs.sendMessage(tid, { action: 'set-page-palette', palette: seq.palette }, () => {});
              } catch (e) { /* ignore */ }
            }
          }
        } catch (e) { /* ignore */ }

        if (seq.autoExplore) {
          // send auto-explore message and handle immediate send errors
          chrome.tabs.sendMessage(tid, { action: 'auto-explore', websites: seq.websites }, (resp) => {
            if (chrome.runtime.lastError) {
              // content script not reachable (likely blocked) — mark unregistered and continue
              markUnregistered(url);
              delete seq.trackers[tid];
              openNextForSequence(seqId);
              return;
            }

            // Set a timeout: if content doesn't signal completion, mark unregistered and continue
            const TO_MS = 8000;
            seq.trackers[tid].timeoutId = setTimeout(() => {
              // timed out waiting for content signal
              markUnregistered(url);
              delete seq.trackers[tid];
              openNextForSequence(seqId);
            }, TO_MS);
          });
        } else {
          // For non-autoExplore just continue shortly after opening
          setTimeout(() => openNextForSequence(seqId), 600);
        }
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

// Handle messages to start sequence and notifications of completion
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'start_sequence') {
    const seqId = `seq_${Date.now()}_${Math.floor(Math.random()*10000)}`;
    
    // If using trending sites, fetch them; otherwise use provided static list
    const useTrendingSites = !!msg.useTrendingSites;
    
    if (useTrendingSites) {
      fetchTrendingUrls().then((trendingUrls) => {
        const sitesToUse = trendingUrls && trendingUrls.length > 0 ? trendingUrls : msg.websites;
        sequences[seqId] = {
          remaining: Number(msg.repetitions) || 1,
          autoExplore: !!msg.autoExplore,
          websites: sitesToUse,
          applyThemeToNewTab: !!msg.applyThemeToNewTab,
          palette: msg.palette || null,
          trackers: {}
        };
        openNextForSequence(seqId);
        sendResponse({ ok: true, seqId, trending: true });
      });
    } else {
      sequences[seqId] = {
        remaining: Number(msg.repetitions) || 1,
        autoExplore: !!msg.autoExplore,
        websites: msg.websites || [],
        applyThemeToNewTab: !!msg.applyThemeToNewTab,
        palette: msg.palette || null,
        trackers: {}
      };
      openNextForSequence(seqId);
      sendResponse({ ok: true, seqId, trending: false });
    }
    return true;
  }

  if (msg.type === 'auto_explore_done') {
    // sender.tab identifies which tab completed — find its sequence tracker and continue that sequence
    const tabId = sender && sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ ok: false, continued: false });
      return true;
    }

    // find sequence that contains this tracker
    let foundSeqId = null;
    for (const id of Object.keys(sequences)) {
      const seq = sequences[id];
      if (seq.trackers && seq.trackers[tabId]) {
        foundSeqId = id;
        // clear timeout for that tab
        const t = seq.trackers[tabId];
        if (t && t.timeoutId) clearTimeout(t.timeoutId);
        delete seq.trackers[tabId];
        break;
      }
    }

    if (!foundSeqId) {
      sendResponse({ ok: true, continued: false });
      return true;
    }

    // continue sequence (open next tab)
    openNextForSequence(foundSeqId);
    sendResponse({ ok: true, continued: true });
    return true;
  }
});
