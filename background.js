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

    if (seq.autoExplore) {
      // Wait until the tab finishes loading, then send the auto-explore message.
      const onUpdated = (updatedTabId, changeInfo) => {
        if (updatedTabId === tid && changeInfo.status === 'complete') {
          // remove listener
          chrome.tabs.onUpdated.removeListener(onUpdated);

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
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
    } else {
      // For non-autoExplore just continue shortly after opening
      setTimeout(() => openNextForSequence(seqId), 600);
    }
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
          closeAfterClick: !!msg.closeAfterClick,
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
        closeAfterClick: !!msg.closeAfterClick,
        trackers: {}
      };
      openNextForSequence(seqId);
      sendResponse({ ok: true, seqId, trending: false });
    }
    return true;
  }

  // immediate close handler removed; use closeAfterClick checkbox to control per-sequence behavior.

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

        // if sequence requested closing tabs after click, close this tab
        if (seq.closeAfterClick) {
          try {
            chrome.tabs.remove(tabId, () => {
              // ignore errors
            });
          } catch (e) { /* ignore */ }
        }

        break;
      }
    }

    if (!foundSeqId) {
      sendResponse({ ok: true, continued: false });
      return true;
    }

    // continue sequence
    openNextForSequence(foundSeqId);
    sendResponse({ ok: true, continued: true });
    return true;
  }
});
