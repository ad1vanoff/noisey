let themes = [];

const widget = document.getElementById('colorWidget');
const resetBtn = document.getElementById('resetBtn');
const applyBtn = document.getElementById('applyBtn');

let state = { index: 0, applyToPage: false };

const pickBtn = document.getElementById('pickBtn');
const randomBtn = document.getElementById('randomBtn');
const randomWebBtn = document.getElementById('randomWebBtn');
const autoExploreCheck = document.getElementById('autoExploreCheck');
const repetitionsInput = document.getElementById('repetitionsInput');
const trendingCheck = document.getElementById('trendingCheck');
const applyToNewTabCheck = document.getElementById('applyToNewTabCheck');
const brainrotBtn = document.getElementById('brainrotBtn');
const pickerModal = document.getElementById('pickerModal');
const paletteListEl = document.getElementById('paletteList');
const closePicker = document.getElementById('closePicker');

// Default list (used if storage doesn't provide a custom list)
let websites = [];

function loadThemesFromFile() {
	return fetch(chrome.runtime.getURL('themes.json'))
		.then(r => r.json())
		.then(data => { themes = Array.isArray(data) ? data : []; })
		.catch(() => { themes = []; });
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
	const theme = themes[state.index % themes.length];
	widget.style.backgroundColor = theme.colors[0];
	
	// Calculate luminance to determine if text should be light or dark
	const bgColor = theme.colors[0];
	const rgb = parseInt(bgColor.substr(1), 16);
	const r = (rgb >> 16) & 0xff;
	const g = (rgb >> 8) & 0xff;
	const b = (rgb >> 0) & 0xff;
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	widget.style.color = luminance > 0.5 ? '#000' : '#fff';
	
	// Apply font from theme
	if (theme.font) {
		widget.style.fontFamily = theme.font;
	}
	
	widget.innerHTML = '';
	const title = document.createElement('div');
	title.textContent = theme.name;
	title.style.fontWeight = '700';
	widget.appendChild(title);

	const sw = document.createElement('div');
	sw.className = 'swatches';
	theme.colors.forEach(c => {
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
	themes.forEach((t, i) => {
		const card = document.createElement('div');
		card.className = 'palette-card';
		if (i === state.index) card.classList.add('selected');
		const info = document.createElement('div');
		info.style.flex = '1';
		info.textContent = t.name;

		const preview = document.createElement('div');
		preview.className = 'palette-preview';
		t.colors.forEach(c => {
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
			if (state.applyToPage) applyThemeToActiveTab(themes[state.index]);
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
	// apply currently-selected theme
	render();
	saveState();

	if (state.applyToPage) applyThemeToActiveTab(themes[state.index]);
});

// Random button picks a random palette and applies it (but also updates selection)

randomBtn.addEventListener('click', () => {
	state.index = Math.floor(Math.random() * themes.length);
	render();
	saveState();
	if (state.applyToPage) applyThemeToActiveTab(themes[state.index]);
});

pickBtn.addEventListener('click', () => showPicker());
closePicker.addEventListener('click', () => hidePicker());
pickerModal.addEventListener('click', (e) => { if (e.target === pickerModal) hidePicker(); });

function applyThemeToActiveTab(theme) {
	chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
		const tab = tabs && tabs[0];
		if (!tab) return;

		chrome.tabs.sendMessage(tab.id, { action: 'set-page-palette', palette: theme }, (resp) => {
			if (chrome.runtime.lastError) {
				console.warn('sendMessage failed, falling back to scripting.executeScript:', chrome.runtime.lastError.message);
				try {
					chrome.scripting.executeScript({
						target: { tabId: tab.id },
						func: (p, f) => {
							const id = 'ext-palette-style';
							const existing = document.getElementById(id);
							if (existing) existing.remove();
							const style = document.createElement('style');
							style.id = id;
							style.textContent = `:root { --ext-1: ${p[0]}; --ext-2: ${p[1]}; --ext-3: ${p[2]}; --ext-4: ${p[3]}; --ext-5: ${p[4]}; --ext-6: ${p[5]}; --ext-7: ${p[6]}; --ext-font: ${f}; } body { background-color: var(--ext-1) !important; color: var(--ext-2) !important; transition: background-color 220ms ease; font-family: var(--ext-font) !important; } a { color: var(--ext-3) !important; } button, input[type=button], .btn { background-color: var(--ext-4) !important; color: var(--ext-2) !important; border-color: var(--ext-3) !important; } h1,h2,h3,h4,h5,h6 { color: var(--ext-5) !important; } nav, header, footer { background-color: var(--ext-6) !important; }`;
							document.head.appendChild(style);
						},
						args: [theme.colors, theme.font || 'Arial, sans-serif']
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
	
	// If turned on, apply the current theme; if turned off, refresh to remove theme
	if (state.applyToPage) {
		applyThemeToActiveTab(themes[state.index]);
	} else {
		// Refresh the page to remove custom theme
		chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
			const tab = tabs && tabs[0];
			if (tab) chrome.tabs.reload(tab.id);
		});
	}
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



// persist apply-to-new-tab preference
function saveApplyToNewTab(val) {
	chrome.storage.sync.set({ applyThemeToNewTab: !!val });
}

function loadApplyToNewTab(cb) {
	chrome.storage.sync.get(['applyThemeToNewTab'], (res) => {
		const v = !!res.applyThemeToNewTab;
		if (applyToNewTabCheck) applyToNewTabCheck.checked = v;
		if (cb) cb(v);
	});
}

applyToNewTabCheck && applyToNewTabCheck.addEventListener('change', (e) => {
	saveApplyToNewTab(e.target.checked);
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

// Open brainrot window on button click
function openBrainrotWindow() {
	chrome.windows.create({
		url: 'https://www.tiktok.com',
		type: 'popup',
		width: 390,
		height: 844
	});
}

brainrotBtn && brainrotBtn.addEventListener('click', () => {
	openBrainrotWindow();
});

randomWebBtn.addEventListener('click', () => {
	const autoExplore = autoExploreCheck.checked;
	const repetitions = Math.max(1, Math.floor(Number(repetitionsInput && repetitionsInput.value) || 1));

	const useTrendingSites = !!(trendingCheck && trendingCheck.checked);
	const applyThemeToNewTab = !!(applyToNewTabCheck && applyToNewTabCheck.checked);
	const theme = themes[state.index];

	// Ask the background service worker to run the sequence so it can coordinate tab lifecycle
	chrome.runtime.sendMessage({ type: 'start_sequence', repetitions, autoExplore, useTrendingSites, websites, applyThemeToNewTab, palette: theme }, (resp) => {
		if (chrome.runtime.lastError) {
			console.warn('start_sequence message failed:', chrome.runtime.lastError);
		}
	});
});


// initialize resources and state
async function initializePopup() {
	await Promise.all([loadThemesFromFile(), loadWebsitesFromFile()]);
	loadState();
	loadRepetitions();
	loadTrending();
	loadApplyToNewTab();
	loadAutoExplore();
	// override file websites with storage if present
	loadWebsites(() => {
		render();
		populatePicker();
	});
}

initializePopup();