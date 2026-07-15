// End-to-end tests: loads the real extension into headless Chrome and
// exercises the options page, storage round-trips, and the popup's
// "Options opens a full tab" behavior.
// Run: npm run test:e2e
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let EXT_ID; // resolved from the running service worker in before()
const extUrl = (file) => `chrome-extension://${EXT_ID}/${file}`;

let browser;
let profileDir;

// Right after launch Chrome can briefly serve ERR_BLOCKED_BY_CLIENT for
// extension pages while the extension is still registering; retry.
async function openExtPage(file) {
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(extUrl(file), { waitUntil: 'load', timeout: 10000 });
      return page;
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

function getStorage(page, key) {
  return page.evaluate((k) => new Promise((res) => chrome.storage.sync.get([k], (v) => res(v[k]))), key);
}

before(async () => {
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noizy-test-'));
  // --load-extension no longer works in branded-Chrome headless; the
  // supported route is installExtension() over the debugging pipe.
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    pipe: true,
    enableExtensions: true,
    userDataDir: profileDir,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  EXT_ID = await browser.installExtension(ROOT);
});

after(async () => {
  await browser?.close();
  fs.rmSync(profileDir, { recursive: true, force: true });
});

beforeEach(async () => {
  // isolate tests: clear synced settings and close everything but one blank tab
  const page = await openExtPage('options.html');
  await page.evaluate(() => new Promise((res) => chrome.storage.sync.clear(res)));
  for (const p of await browser.pages()) {
    if (p !== page) await p.close().catch(() => {});
  }
  await page.goto('about:blank');
  await page.close();
});

test('options page loads with no console errors', async () => {
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(extUrl('options.html'), { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  assert.deepStrictEqual(errors, [], 'no console/page errors');
  assert.strictEqual(await page.title(), 'Noizy · Options');
  await page.close();
});

test('options page populates palettes and default websites', async () => {
  const page = await openExtPage('options.html');
  await page.waitForFunction(() => document.querySelectorAll('#defaultColor option').length > 0);
  const optionCount = await page.$$eval('#defaultColor option', (o) => o.length);
  assert.strictEqual(optionCount, 9, 'all 9 palettes in the dropdown');

  await page.waitForFunction(() => document.getElementById('websitesList').value.length > 0);
  const sites = await page.$eval('#websitesList', (el) => el.value.split('\n'));
  assert.ok(sites.includes('https://www.wikipedia.org'), 'default websites seeded');

  await page.waitForFunction(() => document.getElementById('signedInList').value.length > 0);
  const signedIn = await page.$eval('#signedInList', (el) => el.value);
  assert.match(signedIn, /YouTube \| https:\/\/www\.youtube\.com/, 'signed-in sites seeded from signedin.json');
  await page.close();
});

test('saving options persists to chrome.storage.sync', async () => {
  const page = await openExtPage('options.html');
  await page.waitForFunction(() => document.getElementById('websitesList').value.length > 0);

  await page.select('#defaultColor', '3');
  await page.click('#applyToPage');
  await page.$eval('#websitesList', (el) => { el.value = 'https://example.com\nexample.org'; });
  await page.click('#save'); // fires window.alert; auto-accepted by dialog handler
  await page.waitForFunction(
    () => new Promise((res) => chrome.storage.sync.get(['randomWebsites'], (v) => res(!!v.randomWebsites)))
  );

  const state = await getStorage(page, 'colorWidgetState');
  assert.strictEqual(state.index, 3, 'palette choice saved');
  assert.strictEqual(state.applyToPage, true, 'checkbox saved');

  const websites = await getStorage(page, 'randomWebsites');
  assert.deepStrictEqual(
    websites,
    ['https://example.com', 'https://example.org'],
    'websites saved and bare domains auto-prefixed with https://'
  );
  await page.close();
});

test('removing a site moves it to the blocked list', async () => {
  const page = await openExtPage('options.html');
  await page.evaluate(() => new Promise((res) =>
    chrome.storage.sync.set({ randomWebsites: ['https://keep.com', 'https://drop.com'] }, res)));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('websitesList').value.includes('drop.com'));

  await page.$eval('#websitesList', (el) => { el.value = 'https://keep.com'; });
  await page.click('#save');
  await page.waitForFunction(
    () => new Promise((res) => chrome.storage.sync.get(['randomWebsitesBlocked'], (v) => res((v.randomWebsitesBlocked || []).length > 0)))
  );
  assert.deepStrictEqual(await getStorage(page, 'randomWebsitesBlocked'), ['https://drop.com']);

  // blocked list renders with an Unblock button after reload
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#blockedList button'));
  const label = await page.$eval('#blockedList button', (b) => b.textContent);
  assert.strictEqual(label, 'Unblock');

  // unblocking removes it from storage
  await page.click('#blockedList button');
  await page.waitForFunction(
    () => new Promise((res) => chrome.storage.sync.get(['randomWebsitesBlocked'], (v) => res((v.randomWebsitesBlocked || []).length === 0)))
  );
  await page.close();
});

test('reset restores defaults', async () => {
  const page = await openExtPage('options.html');
  await page.evaluate(() => new Promise((res) =>
    chrome.storage.sync.set({ colorWidgetState: { index: 5, applyToPage: true } }, res)));
  await page.click('#reset');
  await page.waitForFunction(
    () => new Promise((res) => chrome.storage.sync.get(['colorWidgetState'], (v) => res(v.colorWidgetState && v.colorWidgetState.index === 0)))
  );
  const state = await getStorage(page, 'colorWidgetState');
  assert.strictEqual(state.applyToPage, false);
  assert.deepStrictEqual((await getStorage(page, 'randomWebsites'))[0], 'https://www.wikipedia.org');
  await page.close();
});

test('popup Options link opens the options page as a new tab', async () => {
  const popup = await openExtPage('hello.html');
  await popup.waitForSelector('a[href="options.html"]');

  const newTarget = browser.waitForTarget(
    (t) => t.url() === extUrl('options.html'),
    { timeout: 10000 }
  );
  await popup.click('#opts');
  const target = await newTarget;
  assert.ok(target, 'a full options tab was opened instead of navigating the popup');
  // and the popup itself did not navigate away
  assert.notStrictEqual(popup.url(), extUrl('options.html'), 'popup did not navigate in place');
});

test('popup loads without console errors and renders its sections', async () => {
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(extUrl('hello.html'), { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 700));
  assert.deepStrictEqual(errors, [], 'no page errors');
  const text = await page.evaluate(() => document.body.innerText);
  for (const section of ['CUSTOMIZATION', 'BROWSING', 'SIGNED-IN SITES', 'BRAINROT']) {
    assert.ok(text.includes(section), `popup shows ${section} section`);
  }
  await page.close();
});
