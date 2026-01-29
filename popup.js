const palettes = [
	{ name: 'Tropical', colors: ['#FFFAF5','#FFE5CC','#FFB547','#FF8A65','#00897B','#004D40','#37474F'] },
	{ name: 'Dark', colors: ['#F5F5F5','#E0E0E0','#1A237E','#283593','#3F51B5','#512DA8','#0D47A1'] },
	{ name: 'Pink', colors: ['#FFF5F7','#FFE5EC','#FF80AB','#FF4081','#D81B60','#880E4F','#433A4B'] },
	{ name: 'Rainbow', colors: ['#FFFE50','#B6E86B','#52B788','#2D95DE','#6C5CE7','#C83E4D','#FD7272'] },
	{ name: 'Ocean', colors: ['#E8F4F8','#B3E5FC','#4DD0E1','#0097A7','#00838F','#00546B','#263238'] },
	{ name: 'Retro', colors: ['#FEF5E7','#F9E79F','#F5B041','#E67E22','#D35400','#78281F','#2C3E50'] },
	{ name: 'Autumn', colors: ['#FDEBD0','#F8B88B','#E59866','#D68910','#BA4A00','#7B241C','#2C1810'] },
	{ name: 'Neon', colors: ['#0A0E27','#1A1A2E','#10FF00','#FF006E','#8338EC','#FB5607','#FFBE0B'] },
	{ name: 'Serene', colors: ['#F0F7F4','#D1E8E4','#A8D8D8','#6DBCD0','#4A95A4','#2E5F6C','#1E3D43'] }
];

const widget = document.getElementById('colorWidget');
const resetBtn = document.getElementById('resetBtn');
const applyBtn = document.getElementById('applyBtn');

let state = { index: 0, applyToPage: false };

const pickBtn = document.getElementById('pickBtn');
const randomBtn = document.getElementById('randomBtn');
const randomWebBtn = document.getElementById('randomWebBtn');
const autoExploreCheck = document.getElementById('autoExploreCheck');
const pickerModal = document.getElementById('pickerModal');
const paletteListEl = document.getElementById('paletteList');
const closePicker = document.getElementById('closePicker');

// List of interesting websites to randomly visit
const websites = [
	'https://www.wikipedia.org',
	'https://www.reddit.com',
	'https://news.ycombinator.com',
	'https://www.github.com',
	'https://www.producthunt.com',
	'https://www.dribbble.com',
	'https://www.behance.net',
	'https://www.spotify.com',
	'https://www.youtube.com',
	'https://www.nasa.gov',
	'https://www.khanacademy.org',
	'https://www.ted.com',
	'https://www.nature.com',
	'https://www.smithsonianmag.com',
	'https://www.nationalgeographic.com',
	'https://www.bbc.com',
	'https://www.medium.com',
	'https://www.dev.to',
	'https://www.stackoverflow.com',
	'https://www.openai.com'
];

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
randomWebBtn.addEventListener('click', () => {
	const randomUrl = websites[Math.floor(Math.random() * websites.length)];
	const autoExplore = autoExploreCheck.checked;
	
	if (autoExplore) {
		// Create tab and wait for it to load, then inject auto-click logic
		chrome.tabs.create({ url: randomUrl }, (tab) => {
			setTimeout(() => {
				chrome.tabs.sendMessage(tab.id, { action: 'auto-explore', websites }, (resp) => {
					if (chrome.runtime.lastError) {
						console.warn('auto-explore message failed:', chrome.runtime.lastError);
					}
				});
			}, 2500); // Wait for page to load
		});
	} else {
		// Just open the website
		chrome.tabs.create({ url: randomUrl });
	}
});

// initialize
loadState();