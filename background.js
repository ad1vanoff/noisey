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

// ---- dynamic trending topics (for read-only searches) ----
// Fetches a live list of trending search topics from public, no-auth sources.
// These become search-RESULTS URLs on signed-in sites (still read-only GETs).
const TRENDING_TTL_MS = 4 * 60 * 60 * 1000; // cache for 4 hours

// Filter obviously explicit terms so we never inject them into the user's real
// account search history. Not exhaustive; a reasonable safety net.
const NZ_TOPIC_DENY = new Set([
  'porn', 'porno', 'pornography', 'pornhub', 'xxx', 'sex', 'sexual', 'sexy',
  'nude', 'nudes', 'naked', 'nsfw', 'erotic', 'erotica', 'onlyfans', 'hentai',
  'boobs', 'nudity', 'orgy', 'fetish', 'escort', 'camgirl'
]);

function sanitizeTopics(arr) {
  const seen = new Set();
  const out = [];
  for (let t of (arr || [])) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (t.length < 2 || t.length > 60) continue;
    const low = t.toLowerCase();
    if (seen.has(low)) continue;
    const words = low.split(/[^a-z0-9]+/).filter(Boolean);
    if (words.some((w) => NZ_TOPIC_DENY.has(w))) continue;
    seen.add(low);
    out.push(t);
    if (out.length >= 40) break;
  }
  return out;
}

// Google Trends daily RSS — literally "trending searches". Parsed with regex
// because service workers have no DOMParser.
async function fetchGoogleTrends() {
  const resp = await fetch('https://trends.google.com/trending/rss?geo=US');
  if (!resp.ok) throw new Error('gtrends ' + resp.status);
  const xml = await resp.text();
  const titles = [];
  const re = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g;
  let m;
  while ((m = re.exec(xml))) titles.push(m[1].trim());
  return titles.slice(1); // first <title> is the channel title
}

// Wikipedia's most-viewed articles yesterday — a stable JSON fallback.
async function fetchWikipediaTrending() {
  const d = new Date(Date.now() - 86400000); // yesterday (today may not be ready)
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const resp = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${y}/${mo}/${day}`);
  if (!resp.ok) throw new Error('wiki ' + resp.status);
  const data = await resp.json();
  const arts = (data.items && data.items[0] && data.items[0].articles) || [];
  return arts
    .map((a) => String(a.article || '').replace(/_/g, ' '))
    // drop namespaced/meta pages (Special:, Portal:, "Main Page", etc.)
    .filter((t) => t && !/[:/]/.test(t) && !/^main page$/i.test(t) && !/^\d+$/.test(t));
}

// Try sources in order; return the first that yields (sanitized) topics.
async function fetchTrendingTopics() {
  const sources = [fetchGoogleTrends, fetchWikipediaTrending];
  for (const src of sources) {
    try {
      const topics = sanitizeTopics(await src());
      if (topics.length) return topics;
    } catch (e) {
      console.warn('trending source failed:', e && e.message);
    }
  }
  return [];
}

// Cached accessor so background runs don't refetch on every tick.
async function getTrendingTopics() {
  const cached = await new Promise((res) =>
    chrome.storage.local.get(['nzTrending', 'nzTrendingAt'], (r) => res(r || {})));
  if (Array.isArray(cached.nzTrending) && cached.nzTrending.length &&
      Date.now() - (cached.nzTrendingAt || 0) < TRENDING_TTL_MS) {
    return cached.nzTrending;
  }
  const fresh = await fetchTrendingTopics();
  if (fresh.length) chrome.storage.local.set({ nzTrending: fresh, nzTrendingAt: Date.now() });
  return fresh;
}

// Close a tab if the sequence requested auto-closing after exploration.
function closeTabIfNeeded(seq, tabId) {
  if (seq && seq.closeTab && tabId != null) {
    try {
      chrome.tabs.remove(tabId, () => {
        // swallow "No tab with id" errors when the tab is already gone
        if (chrome.runtime.lastError) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
  }
}

// ---- background ("run in background") mode ----
// A single, stoppable sequence that opens tabs without focusing them, at
// random 5-30s intervals, forever. State is persisted so a chrome.alarms
// watchdog can revive the loop if Chrome kills the MV3 service worker.
const BG_SEQ_ID = 'bg_run';
const BG_STATE_KEY = 'nzBackgroundRun';
const BG_ALARM = 'nz-bg-watchdog';
const BG_MIN_DELAY_MS = 5000;
const BG_MAX_DELAY_MS = 30000;

// ---- read-only "signed-in sites" mode ----
// Visits sites the user is logged into and does ONLY read-only things: the tab
// scrolls/dwells (content.js passiveBrowse) and we may OPEN a search-results URL
// (a plain GET). No clicks, likes, comments, follows, or form submits ever run
// on these sites. autoExplore (random clicking) is force-disabled for them.
const SIGNEDIN_KEY = 'signedInConfig';
const PASSIVE_TO_MS = 35000; // safety net if content never signals done

function loadSignedInConfig(cb) {
  chrome.storage.sync.get([SIGNEDIN_KEY], (res) => {
    const stored = res[SIGNEDIN_KEY];
    if (stored && Array.isArray(stored.sites)) { cb(stored); return; }
    // fall back to the bundled default config
    fetch(chrome.runtime.getURL('signedin.json'))
      .then(r => r.json())
      .then(cfg => cb(cfg))
      .catch(() => cb({ sites: [], searchTerms: [] }));
  });
}

function passiveHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return null; }
}

// expand the config into a URL pool (base feeds + search-results URLs) and the
// set of hostnames that should be treated as read-only ("passive") sites
function buildPassivePool(cfg, termsOverride) {
  // trending topics (termsOverride) take precedence over the static search terms
  const terms = ((termsOverride && termsOverride.length ? termsOverride : cfg.searchTerms) || []).filter(Boolean);
  const pool = [];
  const matchers = [];
  const perSite = Math.min(4, Math.max(2, terms.length)); // more search variety when many terms exist
  (cfg.sites || []).forEach((site) => {
    if (!site || !site.url) return;
    const host = passiveHost(site.url);
    if (!host) return;
    if (!matchers.includes(host)) matchers.push(host);
    pool.push(site.url, site.url); // weight the base feed a little
    if (site.searchUrl && site.searchUrl.includes('{q}') && terms.length) {
      for (let i = 0; i < perSite; i++) {
        const q = terms[Math.floor(Math.random() * terms.length)];
        pool.push(site.searchUrl.replace('{q}', encodeURIComponent(q)));
      }
    }
  });
  return { pool, matchers };
}

function isPassiveUrl(url, matchers) {
  if (!matchers || !matchers.length) return false;
  const h = passiveHost(url);
  if (!h) return false;
  return matchers.some((m) => h === m || h.endsWith('.' + m));
}

function scheduleNext(seqId) {
  const seq = sequences[seqId];
  if (!seq) return;
  const delay = BG_MIN_DELAY_MS + Math.random() * (BG_MAX_DELAY_MS - BG_MIN_DELAY_MS);
  if (seq.pendingTimer) clearTimeout(seq.pendingTimer);
  seq.pendingTimer = setTimeout(() => {
    seq.pendingTimer = null;
    openNextForSequence(seqId);
  }, delay);
}

// advance a sequence: background runs pace themselves, foreground continues immediately
function continueSequence(seqId) {
  const seq = sequences[seqId];
  if (!seq) return;
  if (seq.background) scheduleNext(seqId);
  else openNextForSequence(seqId);
}

function stopBackgroundRun(cb) {
  const seq = sequences[BG_SEQ_ID];
  if (seq) {
    if (seq.pendingTimer) clearTimeout(seq.pendingTimer);
    Object.values(seq.trackers || {}).forEach(t => { if (t && t.timeoutId) clearTimeout(t.timeoutId); });
    delete sequences[BG_SEQ_ID];
  }
  chrome.alarms.clear(BG_ALARM);
  chrome.storage.local.remove(BG_STATE_KEY, () => { if (cb) cb(); });
}

// watchdog: revive the loop after a service-worker restart, or kick it if stalled
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== BG_ALARM) return;
  chrome.storage.local.get([BG_STATE_KEY], (res) => {
    const st = res[BG_STATE_KEY];
    if (!st || !st.active || !st.config) {
      chrome.alarms.clear(BG_ALARM);
      return;
    }
    const seq = sequences[BG_SEQ_ID];
    if (!seq) {
      // service worker was restarted — rebuild the sequence from persisted config
      sequences[BG_SEQ_ID] = {
        ...st.config,
        remaining: Infinity,
        background: true,
        trackers: {},
        lastActivity: Date.now(),
        pendingTimer: null
      };
      scheduleNext(BG_SEQ_ID);
    } else if (!seq.pendingTimer && Date.now() - (seq.lastActivity || 0) > 60000) {
      // alive but stalled (lost a tab event) — kick it
      scheduleNext(BG_SEQ_ID);
    }
  });
});

function openNextForSequence(seqId) {
  const seq = sequences[seqId];
  if (!seq) return;
  if (seq.remaining <= 0) {
    delete sequences[seqId];
    return;
  }

  const url = seq.websites[Math.floor(Math.random() * seq.websites.length)];
  seq.lastActivity = Date.now();
  // background runs must never steal the user's focus
  chrome.tabs.create({ url, active: !seq.background }, (tab) => {
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

        // Signed-in site → read-only passive browse (scroll/dwell only). This is
        // checked FIRST so a signed-in site can never fall through to auto-explore.
        if (seq.passiveSites && isPassiveUrl(url, seq.passiveSites)) {
          chrome.tabs.sendMessage(tid, { action: 'passive-browse' }, (resp) => {
            if (chrome.runtime.lastError) {
              // content script unreachable (e.g. a login/redirect page) — just move on.
              // Do NOT mark unregistered; these are the user's own sites.
              closeTabIfNeeded(seq, tid);
              delete seq.trackers[tid];
              continueSequence(seqId);
              return;
            }
            seq.trackers[tid].timeoutId = setTimeout(() => {
              closeTabIfNeeded(seq, tid);
              delete seq.trackers[tid];
              continueSequence(seqId);
            }, PASSIVE_TO_MS);
          });
        } else if (seq.autoExplore) {
          // send auto-explore message and handle immediate send errors
          chrome.tabs.sendMessage(tid, { action: 'auto-explore', websites: seq.websites }, (resp) => {
            if (chrome.runtime.lastError) {
              // content script not reachable (likely blocked) — mark unregistered and continue
              markUnregistered(url);
              closeTabIfNeeded(seq, tid);
              delete seq.trackers[tid];
              continueSequence(seqId);
              return;
            }

            // Set a timeout: if content doesn't signal completion, mark unregistered and continue
            const TO_MS = 8000;
            seq.trackers[tid].timeoutId = setTimeout(() => {
              // timed out waiting for content signal
              markUnregistered(url);
              closeTabIfNeeded(seq, tid);
              delete seq.trackers[tid];
              continueSequence(seqId);
            }, TO_MS);
          });
        } else {
          // For non-autoExplore just continue shortly after opening.
          // If auto-close is on, close the freshly opened tab first so it doesn't linger.
          setTimeout(() => {
            closeTabIfNeeded(seq, tid);
            delete seq.trackers[tid];
            continueSequence(seqId);
          }, 600);
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
    // Start a run from a finished config, honoring background vs. foreground mode.
    const launch = (config, extra) => {
      extra = extra || {};
      if (msg.runInBackground) {
        // one background run at a time — replace any existing one
        stopBackgroundRun(() => {
          sequences[BG_SEQ_ID] = {
            ...config,
            remaining: Infinity,
            background: true,
            trackers: {},
            lastActivity: Date.now(),
            pendingTimer: null
          };
          chrome.storage.local.set({ [BG_STATE_KEY]: { active: true, startedAt: Date.now(), config } });
          chrome.alarms.create(BG_ALARM, { periodInMinutes: 0.5 });
          openNextForSequence(BG_SEQ_ID);
          sendResponse({ ok: true, seqId: BG_SEQ_ID, background: true, ...extra });
        });
      } else {
        const seqId = `seq_${Date.now()}_${Math.floor(Math.random()*10000)}`;
        sequences[seqId] = {
          ...config,
          remaining: Number(msg.repetitions) || 1,
          trackers: {}
        };
        openNextForSequence(seqId);
        sendResponse({ ok: true, seqId, background: false, ...extra });
      }
    };

    // Read-only signed-in-sites mode: build the pool from the saved config.
    if (msg.passiveMode) {
      loadSignedInConfig(async (cfg) => {
        // when trending searches are on, fetch live topics to use as queries
        let trendingTerms = null;
        if (msg.trendingSearches) {
          try {
            const tr = await getTrendingTopics();
            if (tr && tr.length) trendingTerms = tr;
          } catch (e) { /* fall back to the static search terms */ }
        }
        const { pool, matchers } = buildPassivePool(cfg, trendingTerms);
        if (!pool.length) {
          sendResponse({ ok: false, error: 'no signed-in sites configured' });
          return;
        }
        launch({
          autoExplore: false,          // never random-click a signed-in site
          websites: pool,
          passiveSites: matchers,
          applyThemeToNewTab: false,   // don't repaint the user's real accounts
          palette: null,
          closeTab: !!msg.closeTab
        }, { passive: true, trendingSearches: !!msg.trendingSearches, usedTrending: !!trendingTerms });
      });
      return true;
    }

    const buildConfig = (sitesToUse) => ({
      autoExplore: !!msg.autoExplore,
      websites: sitesToUse || [],
      applyThemeToNewTab: !!msg.applyThemeToNewTab,
      palette: msg.palette || null,
      closeTab: !!msg.closeTab
    });

    // If using trending sites, fetch them; otherwise use the provided static list.
    if (msg.useTrendingSites) {
      fetchTrendingUrls().then((trendingUrls) => {
        launch(buildConfig(trendingUrls && trendingUrls.length > 0 ? trendingUrls : msg.websites), { trending: true });
      });
    } else {
      launch(buildConfig(msg.websites), { trending: false });
    }
    return true;
  }

  if (msg.type === 'stop_background_run') {
    stopBackgroundRun(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'get_background_status') {
    chrome.storage.local.get([BG_STATE_KEY], (res) => {
      const st = res[BG_STATE_KEY];
      sendResponse({ active: !!(st && st.active), startedAt: st ? st.startedAt : null });
    });
    return true;
  }

  if (msg.type === 'auto_explore_done' || msg.type === 'passive_browse_done') {
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
        // close the explored tab if auto-close is enabled for this sequence
        closeTabIfNeeded(seq, tabId);
        delete seq.trackers[tabId];
        break;
      }
    }

    if (!foundSeqId) {
      sendResponse({ ok: true, continued: false });
      return true;
    }

    // continue sequence (open next tab; background runs pace themselves)
    sequences[foundSeqId].lastActivity = Date.now();
    continueSequence(foundSeqId);
    sendResponse({ ok: true, continued: true });
    return true;
  }
});
