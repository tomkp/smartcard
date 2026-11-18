// Checks the reports AddressSanitizer wrote (ASAN_OPTIONS log_path) while
// the tests ran against an ASan build of the addon: see the sanitizers job
// in .github/workflows/test.yml.
//
//   node scripts/check-asan-logs.js <log dir>
//
// Fails on any memory error, and on any leak allocated through the addon.
// Node itself isn't built with ASan and leaks a little at every exit (and
// so does anything else the tests start), so a leak counts only if its
// allocation stack has a frame in the addon: its source, node-addon-api's
// headers compiled into it, or smartcard_napi.node when unsymbolized.
//
// One leak is expected: napi_create_promise's handle for a promise never
// settled. A promise still pending when its worker's environment is torn
// down can't be settled any more (Node runs no JS by then), and settling
// is the only way to free that handle. In a live environment an unsettled
// promise would be a hang, which the tests would notice anyway.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dir = process.argv[2];
if (!dir) {
    console.error('usage: check-asan-logs.js <log dir>');
    process.exit(2);
}

const files = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : [];
if (files.length === 0) {
    // Every process that loads the ASan runtime leaks something of Node's
    // at exit, so no reports at all means ASan never ran
    console.error(`No ASan reports in ${dir}: was the addon built with ASan, and libasan preloaded?`);
    process.exit(1);
}

// The addon's sources appear as ../src/ (relative to build/); ASan's own
// frames as ../../../../src/libsanitizer/
const ADDON_FRAME = /smartcard_napi\.node|\s\.\.\/src\/|node-addon-api\/napi/;
const EXPECTED = /\bnapi_create_promise\b/;

let memoryErrors = 0;
let leaks = 0;
let expectedLeaks = 0;
const failures = [];

for (const file of files) {
    const text = fs.readFileSync(file, 'utf-8');
    // A memory error ends the process: report the whole log
    if (/ERROR: AddressSanitizer/.test(text)) {
        memoryErrors++;
        failures.push(`${path.basename(file)}: memory error\n${text}`);
        continue;
    }
    for (const block of text.split(/\n\s*\n/)) {
        if (!/^(Direct|Indirect) leak/m.test(block)) {
            continue;
        }
        leaks++;
        if (!ADDON_FRAME.test(block)) {
            continue;
        }
        if (EXPECTED.test(block)) {
            expectedLeaks++;
            continue;
        }
        failures.push(`${path.basename(file)}: leak through the addon\n${block.trim()}`);
    }
}

console.log(
    `${files.length} ASan reports: ${memoryErrors} with a memory error; ` +
        `${leaks} leaks, ${expectedLeaks} of them expected (unsettled promises at ` +
        `worker teardown), ${failures.length - memoryErrors} other leaks through the addon`
);
if (failures.length > 0) {
    console.error(`\n${failures.join('\n\n')}`);
    process.exit(1);
}
