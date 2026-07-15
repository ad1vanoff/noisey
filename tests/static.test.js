// Static sanity checks: manifest integrity, referenced files, bundled JSON.
// Run: npm run test:static
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const manifest = JSON.parse(read('manifest.json'));

test('manifest is valid MV3', () => {
  assert.strictEqual(manifest.manifest_version, 3);
  assert.ok(manifest.name, 'name is set');
  assert.ok(manifest.version, 'version is set');
  assert.ok(manifest.description.length <= 132, 'description fits the store limit');
});

test('manifest references only files that exist', () => {
  const refs = [
    manifest.action.default_popup,
    manifest.background.service_worker,
    manifest.options_page,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action.default_icon || {}),
    ...manifest.content_scripts.flatMap((cs) => cs.js),
  ];
  for (const ref of refs) {
    assert.ok(exists(ref), `missing file referenced by manifest: ${ref}`);
  }
});

test('all four store icon sizes are present', () => {
  for (const size of [16, 32, 48, 128]) {
    assert.ok(manifest.icons[size], `manifest.icons["${size}"] declared`);
    const buf = fs.readFileSync(path.join(ROOT, manifest.icons[size]));
    assert.deepStrictEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'is a PNG');
    // width and height live at fixed offsets in the IHDR chunk
    assert.strictEqual(buf.readUInt32BE(16), size, `width is ${size}`);
    assert.strictEqual(buf.readUInt32BE(20), size, `height is ${size}`);
  }
});

test('bundled JSON/config assets parse', () => {
  const palettes = JSON.parse(read('palettes.json'));
  assert.ok(Array.isArray(palettes) && palettes.length > 0);
  for (const p of palettes) {
    assert.ok(p.name && Array.isArray(p.colors) && p.colors.length >= 5, `palette ${p.name} well-formed`);
  }

  JSON.parse(read('themes.json'));

  const signedIn = JSON.parse(read('signedin.json'));
  assert.ok(Array.isArray(signedIn.sites) && signedIn.sites.length > 0);
  for (const s of signedIn.sites) {
    assert.match(s.url, /^https:\/\//, `${s.name} url is https`);
  }
  assert.ok(Array.isArray(signedIn.searchTerms) && signedIn.searchTerms.length > 0);

  const sites = read('websites.txt').split('\n').map((l) => l.trim()).filter(Boolean);
  assert.ok(sites.length > 0, 'websites.txt has entries');
});

test('permissions are only the ones the code uses', () => {
  const code = ['background.js', 'popup.js', 'options.js', 'content.js'].map(read).join('\n');
  for (const perm of manifest.permissions) {
    if (perm === 'activeTab') continue; // implicit: user-invoked popup actions
    assert.ok(
      code.includes(`chrome.${perm}`) || code.includes(`chrome.${perm.replace(/s$/, '')}`),
      `permission "${perm}" is actually used in code`
    );
  }
});
