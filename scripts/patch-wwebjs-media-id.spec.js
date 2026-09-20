'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyMediaIdPatch, MEDIA_ID_FIND, MEDIA_ID_REPLACE, MEDIA_ID_MARKER } = require('./patch-wwebjs-media-id');

/**
 * Same contract as the sibling patchers: this rewrites a file the repository doesn't own, so it
 * must fire only on the exact shape it was written for, and refuse loudly on anything else rather
 * than silently shipping a build where media sends are still broken.
 */
function fakeWwjs(utilsSource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwjs-media-id-'));
  const utilsDir = path.join(dir, 'src', 'util', 'Injected');
  fs.mkdirSync(utilsDir, { recursive: true });
  fs.writeFileSync(path.join(utilsDir, 'Utils.js'), utilsSource);
  return { dir, utilsFile: path.join(utilsDir, 'Utils.js') };
}

const withSnippet = (snippet) => `exports.sendMsg = async () => {\n    const message = {};\n\n${snippet}\n    if (botOptions) {\n        delete message.canonicalUrl;\n    }\n};\n`;

const PRISTINE = withSnippet(MEDIA_ID_FIND);

test('applies the __x_id deletion to a pristine upstream tree', () => {
  const { dir, utilsFile } = fakeWwjs(PRISTINE);

  const result = applyMediaIdPatch(dir);

  assert.equal(result.applied, true);
  const patched = fs.readFileSync(utilsFile, 'utf8');
  assert.ok(patched.includes(MEDIA_ID_REPLACE));
  assert.ok(patched.includes(MEDIA_ID_MARKER));
});

test('is idempotent — a second run is a no-op, not a double patch', () => {
  const { dir, utilsFile } = fakeWwjs(PRISTINE);
  applyMediaIdPatch(dir);
  const once = fs.readFileSync(utilsFile, 'utf8');

  const result = applyMediaIdPatch(dir);

  assert.equal(result.applied, false);
  assert.equal(fs.readFileSync(utilsFile, 'utf8'), once);
  assert.equal(once.split('delete message.__x_id;').length - 1, 1);
});

test('refuses an unrecognized Utils.js shape instead of silently skipping', () => {
  const { dir } = fakeWwjs('exports.sendMsg = async () => {};\n');

  assert.throws(() => applyMediaIdPatch(dir), /unsupported Utils\.js shape/);
});

test('errors when whatsapp-web.js is not installed', () => {
  const missingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwjs-missing-'));
  assert.throws(() => applyMediaIdPatch(missingDir), /not found/);
});
