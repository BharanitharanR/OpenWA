/**
 * Repair media sending (image/video/audio/voice) on whatsapp-web.js 1.34.7, broken by WhatsApp Web
 * builds rolled out starting 2026-09-17. Confirmed live on this project's own WhatsApp session:
 * every media send died with "Data passed to getter must include an id property (it's how we
 * memoize) but got undefined", reproduced across two independently-resolved WhatsApp Web build
 * pins (ruling out a single bad build) while plain text sends kept working fine.
 *
 * Root cause: `sendMsg`'s outgoing `message` object is built as
 * `{ ...options, id: newMsgKey, ..., ...mediaOptions, ... }` - mediaOptions carries whatsapp-web.js's
 * own internal `__x_id` field (used by its in-browser model for memoization), and being spread in
 * AFTER `id: newMsgKey` silently clobbers the real WAWebMsgKey the message needs with that internal
 * value instead. Every downstream getter that expects `message.id` to be a real key then throws the
 * "must include an id property" error the moment it tries to read it.
 *
 * Fix (matches the open upstream PR wwebjs/whatsapp-web.js#201923 and the equivalent patch already
 * shipped in rmyndharis/OpenWA#1670): delete `message.__x_id` right after the object is built,
 * before anything reads `message.id`. Placed immediately before the existing canonicalUrl deletion
 * this file already patches for a separate, older bug - same spot, same file, same convention.
 *
 * Self-disabling like every sibling patcher here: an unrecognized Utils.js shape fails the build
 * instead of silently shipping without the fix.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WWJS = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js');
const UTILS_PATH = path.join('src', 'util', 'Injected', 'Utils.js');

const MEDIA_ID_FIND = `        // Bot's won't reply if canonicalUrl is set (linking)`;

// Deliberately the same comment line MEDIA_ID_FIND targets - the replace text is inserted directly
// before it, so MEDIA_ID_FIND is itself a substring of MEDIA_ID_REPLACE. That makes plain
// find/replace occurrence-counting useless for telling "pristine" from "already patched" (both
// contain MEDIA_ID_FIND exactly once) - MEDIA_ID_MARKER, present only once patching has happened,
// is what actually distinguishes the two states.
const MEDIA_ID_MARKER = 'delete message.__x_id;';

const MEDIA_ID_REPLACE = `        // mediaOptions carries whatsapp-web.js's own internal __x_id, used for its in-browser
        // model's memoization. Spread into \`message\` above as \`...mediaOptions\`, it clobbers the
        // real WAWebMsgKey \`id\` this message needs, and every media send (image/video/audio/voice)
        // then dies deep inside WhatsApp Web's own store with "Data passed to getter must include
        // an id property (it's how we memoize) but got undefined" - confirmed live on this
        // project's own WhatsApp session against current WhatsApp Web builds. Matches the upstream
        // fix at wwebjs/whatsapp-web.js#201923.
        ${MEDIA_ID_MARKER}

        // Bot's won't reply if canonicalUrl is set (linking)`;

function applyMediaIdPatch(wwjsDir = DEFAULT_WWJS) {
  const utilsFile = path.join(wwjsDir, UTILS_PATH);
  if (!fs.existsSync(utilsFile)) {
    throw new Error(`whatsapp-web.js Utils.js not found at ${utilsFile}`);
  }

  const source = fs.readFileSync(utilsFile, 'utf8');
  const finds = source.split(MEDIA_ID_FIND).length - 1;
  const hasMarker = source.includes(MEDIA_ID_MARKER);

  if (finds === 1 && hasMarker) {
    return { applied: false };
  }
  if (finds === 1 && !hasMarker) {
    fs.writeFileSync(utilsFile, source.replace(MEDIA_ID_FIND, MEDIA_ID_REPLACE));
    return { applied: true };
  }
  throw new Error(
    `unsupported Utils.js shape for the media __x_id repair ` +
      `(occurrences of the canonicalUrl comment: ${finds}, __x_id marker present: ${hasMarker}); ` +
      're-evaluate this transform against the installed whatsapp-web.js',
  );
}

function run() {
  const bestEffort = process.argv.includes('--best-effort');
  try {
    const { applied } = applyMediaIdPatch();
    console.log(`patch-wwebjs-media-id: ${applied ? 'applied' : 'skipped (already present)'}`);
  } catch (error) {
    if (bestEffort) {
      console.warn(`patch-wwebjs-media-id: skipped — ${error.message}`);
      return;
    }
    console.error(`patch-wwebjs-media-id: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) run();

module.exports = { applyMediaIdPatch, MEDIA_ID_FIND, MEDIA_ID_REPLACE, MEDIA_ID_MARKER };
