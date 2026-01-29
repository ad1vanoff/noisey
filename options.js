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

function save() {
  const state = { index: Number(defaultColorSelect.value), applyToPage: !!applyToPageCheckbox.checked };
  chrome.storage.sync.set({ colorWidgetState: state }, () => {
    window.alert('Options saved');
  });
}

function resetDefaults() {
  const defaults = { index: 0, applyToPage: false };
  chrome.storage.sync.set({ colorWidgetState: defaults }, () => {
    load();
    window.alert('Defaults restored');
  });
}

populateColors();
load();

saveBtn.addEventListener('click', save);
resetBtn.addEventListener('click', resetDefaults);
