let palettes = [];

const widget = document.getElementById('colorWidget');
const resetBtn = document.getElementById('resetBtn');
const applyBtn = document.getElementById('applyBtn');

let state = { index: 0, applyToPage: false };

const pickBtn = document.getElementById('pickBtn');
const randomBtn = document.getElementById('randomBtn');
const randomWebBtn = document.getElementById('randomWebBtn');
const autoExploreCheck = document.getElementById('autoExploreCheck');
const repetitionsInput = document.getElementById('repetitionsInput');
const closeAfterClickCheck = document.getElementById('closeAfterClickCheck');
const trendingCheck = document.getElementById('trendingCheck');
const pickerModal = document.getElementById('pickerModal');
const paletteListEl = document.getElementById('paletteList');
const closePicker = document.getElementById('closePicker');

// Default list (used if storage doesn't provide a custom list)
let websites = [];

function loadPalettesFromFile() {
	return fetch(chrome.runtime.getURL('palettes.json'))
		.then(r => r.json())
		.then(data => { palettes = Array.isArray(data) ? data : []; })
		.catch(() => { palettes = []; });
}

function loadWebsitesFromFile() {
	return fetch(chrome.runtime.getURL('websites.txt'))
		.then(r => r.text())
		.then(t => {
			websites = t.split('\n').map(s => s.trim()).filter(Boolean);
		})
		.catch(() => { websites = []; });
}

function loadWebsites(cb) {
	chrome.storage.sync.get(['randomWebsites'], (res) => {
		if (Array.isArray(res.randomWebsites) && res.randomWebsites.length) {
			websites = res.randomWebsites;
		}
		if (cb) cb(websites);
	});
}

function render() {
	const pal = palettes[state.index % palettes.length];
	widget.style.backgroundColor = pal.colors[0];
	widget.style.color = '#111';
	widget.innerHTML = '';
	const title = document.createElement('div');
	title.textContent = pal.name;
	title.style.fontWeight = '700';
	widget.appendChild(title);

	const sw = document.createElement('div');
	sw.className = 'swatches';
	pal.colors.forEach(c => {
		const s = document.createElement('span');
		s.className = 'swatch';
		s.style.backgroundColor = c;
		sw.appendChild(s);
	});
	widget.appendChild(sw);

	applyBtn.textContent = state.applyToPage ? 'Applying ✓' : 'Apply to page';

	// reflect selection in picker if open
	const cards = paletteListEl && paletteListEl.querySelectorAll('.palette-card');
	if (cards && cards.length) {
		cards.forEach((c, i) => c.classList.toggle('selected', i === state.index));
	}
}

function populatePicker() {
	if (!paletteListEl) return;
	paletteListEl.innerHTML = '';
	palettes.forEach((p, i) => {
		const card = document.createElement('div');
		card.className = 'palette-card';
		if (i === state.index) card.classList.add('selected');
		const info = document.createElement('div');
		info.style.flex = '1';
		info.textContent = p.name;

		const preview = document.createElement('div');
		preview.className = 'palette-preview';
		p.colors.forEach(c => {
			const sw = document.createElement('span');
			sw.className = 'palette-swatch';
			sw.style.backgroundColor = c;
			preview.appendChild(sw);
		});

		card.appendChild(info);
		card.appendChild(preview);
		card.addEventListener('click', () => {
			state.index = i;
			render();
			saveState();
			hidePicker();
			if (state.applyToPage) applyPaletteToActiveTab(palettes[state.index]);
		});
		paletteListEl.appendChild(card);
	});
}

function showPicker() {
	populatePicker();
	pickerModal.style.display = 'flex';
}

function hidePicker() {
	pickerModal.style.display = 'none';
}

function saveState() {
	chrome.storage.sync.set({ colorWidgetState: state });
}

function loadState() {
	chrome.storage.sync.get(['colorWidgetState'], (res) => {
		if (res.colorWidgetState) state = res.colorWidgetState;
		render();
	});
}

// Apply the currently selected palette when widget clicked
widget.addEventListener('click', () => {
	// apply currently-selected palette
	render();
	saveState();

	if (state.applyToPage) applyPaletteToActiveTab(palettes[state.index]);
});

// Random button picks a random palette and applies it (but also updates selection)

randomBtn.addEventListener('click', () => {
	state.index = Math.floor(Math.random() * palettes.length);
	render();
	saveState();
	if (state.applyToPage) applyPaletteToActiveTab(palettes[state.index]);
});

pickBtn.addEventListener('click', () => showPicker());
closePicker.addEventListener('click', () => hidePicker());
pickerModal.addEventListener('click', (e) => { if (e.target === pickerModal) hidePicker(); });

function applyPaletteToActiveTab(palette) {
	chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
		const tab = tabs && tabs[0];
		if (!tab) return;

		chrome.tabs.sendMessage(tab.id, { action: 'set-page-palette', palette }, (resp) => {
			if (chrome.runtime.lastError) {
				console.warn('sendMessage failed, falling back to scripting.executeScript:', chrome.runtime.lastError.message);
				try {
					chrome.scripting.executeScript({
						target: { tabId: tab.id },
						func: (p) => {
							const id = 'ext-palette-style';
							const existing = document.getElementById(id);
							if (existing) existing.remove();
							const style = document.createElement('style');
							style.id = id;
							style.textContent = `:root { --ext-1: ${p[0]}; --ext-2: ${p[1]}; --ext-3: ${p[2]}; --ext-4: ${p[3]}; --ext-5: ${p[4]}; --ext-6: ${p[5]}; --ext-7: ${p[6]}; } body { background-color: var(--ext-1) !important; color: var(--ext-2) !important; transition: background-color 220ms ease; } a { color: var(--ext-3) !important; } button, input[type=button], .btn { background-color: var(--ext-4) !important; color: var(--ext-2) !important; border-color: var(--ext-3) !important; } h1,h2,h3,h4,h5,h6 { color: var(--ext-5) !important; } nav, header, footer { background-color: var(--ext-6) !important; }`;
							document.head.appendChild(style);
						},
						args: [palette.colors]
					});
				} catch (e) {
					console.error('scripting.executeScript failed:', e);
				}
			}
		});
	});
}

resetBtn.addEventListener('click', () => {
	state.index = 0;
	render();
	saveState();
});

applyBtn.addEventListener('click', () => {
	state.applyToPage = !state.applyToPage;
	render();
	saveState();
});

// Random website button: opens a random website in a new tab
// timing constants (tuned for snappier interactions)
const LOAD_WAIT_MS = 1800; // wait before sending auto-explore message after opening tab
const NEXT_DELAY_MS = 2800; // delay between opening sequential random tabs

function saveRepetitions(value) {
	const v = Math.max(1, Math.floor(Number(value) || 1));
	chrome.storage.sync.set({ randomRepetitions: v });
}

function loadRepetitions(cb) {
	chrome.storage.sync.get(['randomRepetitions'], (res) => {
		const v = res.randomRepetitions || 1;
		if (repetitionsInput) repetitionsInput.value = v;
		if (cb) cb(v);
	});
}

repetitionsInput && repetitionsInput.addEventListener('change', (e) => {
	saveRepetitions(e.target.value);
});

// persist close-after-click preference
function saveCloseAfterClick(val) {
	chrome.storage.sync.set({ closeAfterClick: !!val });
}

function loadCloseAfterClick(cb) {
	chrome.storage.sync.get(['closeAfterClick'], (res) => {
		const v = !!res.closeAfterClick;
		if (closeAfterClickCheck) closeAfterClickCheck.checked = v;
		if (cb) cb(v);
	});
}

closeAfterClickCheck && closeAfterClickCheck.addEventListener('change', (e) => {
	saveCloseAfterClick(e.target.checked);
});

// persist trending preference
function saveTrending(val) {
	chrome.storage.sync.set({ useTrendingSites: !!val });
}

function loadTrending(cb) {
	chrome.storage.sync.get(['useTrendingSites'], (res) => {
		const v = !!res.useTrendingSites;
		if (trendingCheck) trendingCheck.checked = v;
		if (cb) cb(v);
	});
}

trendingCheck && trendingCheck.addEventListener('change', (e) => {
	saveTrending(e.target.checked);
});

randomWebBtn.addEventListener('click', () => {
	const autoExplore = autoExploreCheck.checked;
	const repetitions = Math.max(1, Math.floor(Number(repetitionsInput && repetitionsInput.value) || 1));
	const closeAfterClick = !!(closeAfterClickCheck && closeAfterClickCheck.checked);
	const useTrendingSites = !!(trendingCheck && trendingCheck.checked);
	
	// Ask the background service worker to run the sequence so it can coordinate tab lifecycle
	chrome.runtime.sendMessage({ type: 'start_sequence', repetitions, autoExplore, closeAfterClick, useTrendingSites, websites }, (resp) => {
		if (chrome.runtime.lastError) {
			console.warn('start_sequence message failed:', chrome.runtime.lastError);
		}
	});
});

// 'Close Noisey Tabs' immediate-close button removed; use 'Close tabs after clicking' checkbox instead.

// initialize resources and state
async function initializePopup() {
	await Promise.all([loadPalettesFromFile(), loadWebsitesFromFile()]);
	loadState();
	loadRepetitions();
	loadCloseAfterClick();
	loadTrending();
	// override file websites with storage if present
	loadWebsites(() => {
		render();
		populatePicker();
	});
}

initializePopup();