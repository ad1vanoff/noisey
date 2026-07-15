const palettes = [
  { name: 'Tropical' },
  { name: 'Dark' },
  { name: 'Pink' },
  { name: 'Rainbow' },
  { name: 'Ocean' },
  { name: 'Retro' },
  { name: 'Autumn' },
  { name: 'Neon' },
  { name: 'Serene' }
];

const defaultColorSelect = document.getElementById('defaultColor');
const applyToPageCheckbox = document.getElementById('applyToPage');
const saveBtn = document.getElementById('save');
const resetBtn = document.getElementById('reset');
const websitesListEl = document.getElementById('websitesList');

const defaultWebsites = [
  'https://www.wikipedia.org',
  'https://news.ycombinator.com',
  'https://www.github.com',
  'https://www.producthunt.com',
  'https://www.dribbble.com',
  'https://www.behance.net',
  'https://www.spotify.com',
  'https://www.youtube.com',
  'https://www.nasa.gov'
];
const unregisteredEl = document.getElementById('unregisteredList');
const blockedEl = document.getElementById('blockedList');
const signedInListEl = document.getElementById('signedInList');
const searchTermsListEl = document.getElementById('searchTermsList');

// ---- signed-in (read-only) sites config ----
function serializeSignedIn(cfg) {
  const lines = (cfg.sites || []).map((s) => {
    const parts = [s.name || '', s.url || ''];
    if (s.searchUrl) parts.push(s.searchUrl);
    return parts.join(' | ');
  });
  if (signedInListEl) signedInListEl.value = lines.join('\n');
  if (searchTermsListEl) searchTermsListEl.value = (cfg.searchTerms || []).join('\n');
}

function parseSignedIn() {
  const sites = (signedInListEl ? signedInListEl.value.split('\n') : [])
    .map((line) => line.split('|').map((p) => p.trim()))
    .filter((parts) => parts[1]) // must have a URL
    .map((parts) => ({
      name: parts[0] || parts[1],
      url: /^https?:\/\//i.test(parts[1]) ? parts[1] : 'https://' + parts[1],
      searchUrl: parts[2] || ''
    }));
  const searchTerms = (searchTermsListEl ? searchTermsListEl.value.split('\n') : [])
    .map((s) => s.trim())
    .filter(Boolean);
  return { sites, searchTerms };
}

function loadSignedIn() {
  chrome.storage.sync.get(['signedInConfig'], (res) => {
    if (res.signedInConfig && Array.isArray(res.signedInConfig.sites)) {
      serializeSignedIn(res.signedInConfig);
      return;
    }
    // seed the editor from the bundled default
    fetch(chrome.runtime.getURL('signedin.json'))
      .then((r) => r.json())
      .then((cfg) => serializeSignedIn(cfg))
      .catch(() => serializeSignedIn({ sites: [], searchTerms: [] }));
  });
}

function renderBlocked(list) {
  if (!blockedEl) return;
  blockedEl.innerHTML = '';
  if (!list || !list.length) {
    blockedEl.textContent = 'No blocked sites.';
    return;
  }
  list.forEach((url) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.marginBottom = '6px';
    const t = document.createElement('div');
    t.style.flex = '1';
    t.style.wordBreak = 'break-all';
    t.textContent = url;
    const btn = document.createElement('button');
    btn.textContent = 'Unblock';
    btn.style.marginLeft = '8px';
    btn.addEventListener('click', () => {
      chrome.storage.sync.get(['randomWebsitesBlocked'], (res) => {
        const arr = Array.isArray(res.randomWebsitesBlocked) ? res.randomWebsitesBlocked.filter(u => u !== url) : [];
        chrome.storage.sync.set({ randomWebsitesBlocked: arr }, () => renderBlocked(arr));
      });
    });
    row.appendChild(t);
    row.appendChild(btn);
    blockedEl.appendChild(row);
  });
}

function renderUnregistered(list) {
  if (!unregisteredEl) return;
  unregisteredEl.innerHTML = '';
  if (!list || !list.length) {
    unregisteredEl.textContent = 'No unregistered sites.';
    return;
  }
  list.forEach((url) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.marginBottom = '6px';
    const t = document.createElement('div');
    t.style.flex = '1';
    t.style.wordBreak = 'break-all';
    t.textContent = url;
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.style.marginLeft = '8px';
    btn.addEventListener('click', () => {
      chrome.storage.sync.get(['randomWebsitesUnregistered'], (res) => {
        const arr = Array.isArray(res.randomWebsitesUnregistered) ? res.randomWebsitesUnregistered.filter(u => u !== url) : [];
        chrome.storage.sync.set({ randomWebsitesUnregistered: arr }, () => renderUnregistered(arr));
      });
    });
    row.appendChild(t);
    row.appendChild(btn);
    unregisteredEl.appendChild(row);
  });
}

function populateColors() {
  palettes.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    defaultColorSelect.appendChild(opt);
  });
}

function load() {
  chrome.storage.sync.get(['colorWidgetState'], (res) => {
    const state = res.colorWidgetState || { index: 0, applyToPage: false };
    defaultColorSelect.value = state.index || 0;
    applyToPageCheckbox.checked = !!state.applyToPage;
  });
}
  // load websites
  chrome.storage.sync.get(['randomWebsites'], (res) => {
    const list = Array.isArray(res.randomWebsites) && res.randomWebsites.length ? res.randomWebsites : defaultWebsites;
    if (websitesListEl) websitesListEl.value = list.join('\n');
  });

  // load unregistered
  chrome.storage.sync.get(['randomWebsitesUnregistered'], (res) => {
    const list = Array.isArray(res.randomWebsitesUnregistered) ? res.randomWebsitesUnregistered : [];
    renderUnregistered(list);
  });

  // load blocked
  chrome.storage.sync.get(['randomWebsitesBlocked'], (res) => {
    const list = Array.isArray(res.randomWebsitesBlocked) ? res.randomWebsitesBlocked : [];
    renderBlocked(list);
  });

function save() {
  const state = { index: Number(defaultColorSelect.value), applyToPage: !!applyToPageCheckbox.checked };
  let websites = (websitesListEl && websitesListEl.value.split('\n').map(s => s.trim()).filter(Boolean)) || defaultWebsites;
  // Validation: ensure each starts with http:// or https://, auto-prepend https:// if missing
  const fixed = [];
  websites = websites.map((u) => {
    if (!/^https?:\/\//i.test(u)) {
      fixed.push(u);
      return 'https://' + u;
    }
    return u;
  });

  // Track sites that were removed and add them to blocked list
  chrome.storage.sync.get(['randomWebsites', 'randomWebsitesBlocked'], (res) => {
    const oldWebsites = Array.isArray(res.randomWebsites) ? res.randomWebsites : [];
    const blockedList = Array.isArray(res.randomWebsitesBlocked) ? res.randomWebsitesBlocked : [];
    const removed = oldWebsites.filter(u => !websites.includes(u));
    const newBlocked = Array.from(new Set([...blockedList, ...removed])); // deduplicate

    const signedInConfig = parseSignedIn();

    chrome.storage.sync.set({ colorWidgetState: state, randomWebsites: websites, randomWebsitesBlocked: newBlocked, signedInConfig }, () => {
      load();
      // inform about auto-fixed entries
      if (fixed.length) {
        window.alert('Saved. The following entries were auto-prefixed with https://:\n' + fixed.join('\n'));
      } else {
        window.alert('Options saved');
      }
    });
  });
}

function resetDefaults() {
  const defaults = { index: 0, applyToPage: false };
  chrome.storage.sync.set({ colorWidgetState: defaults, randomWebsites: defaultWebsites }, () => {
    load();
    window.alert('Defaults restored');
  });
}

populateColors();
load();
loadSignedIn();

saveBtn.addEventListener('click', save);
resetBtn.addEventListener('click', resetDefaults);
