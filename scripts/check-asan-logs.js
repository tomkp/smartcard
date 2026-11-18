// Checks the reports AddressSanitizer wrote (ASAN_OPTIONS log_path) while
// the tests ran against an ASan build of the addon: see the sanitizers job
// in .github/workflows/test.yml.
//
//   node scripts/check-asan-logs.js <log dir> <addon.node>
//
// Fails on any memory error, on LeakSanitizer failing to run, and on any
// leak the addon allocated. Node isn't built with ASan and leaks a little
// at every exit (so does anything else the tests start), so a leak counts
// as the addon's only if the code that allocated it is the addon's: the
// first frame of its allocation stack that isn't the allocator, the C++
// runtime, or Node-API's implementation (which allocates on the addon's
// behalf, as for a reference or a promise). V8 allocating internally
// while the addon happens to be further up the stack is Node's.
//
// One leak is expected: napi_create_promise's handle for a promise never
// settled. A promise still pending when its worker's environment is torn
// down can't be settled any more (Node runs no JS by then), and settling
// is the only way to free that handle. A promise left pending in a live
// environment would be a hang, which the tests would notice.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [dir, addon] = process.argv.slice(2);
if (!dir || !addon) {
    console.error('usage: check-asan-logs.js <log dir> <addon.node>');
    process.exit(2);
}

// The addon itself must be instrumented: with the runtime only preloaded,
// leaks would still be found, but not the addon's memory errors
if (!fs.readFileSync(addon).includes('__asan_report_load')) {
    console.error(`${addon} wasn't built with -fsanitize=address`);
    process.exit(1);
}

const files = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : [];
if (files.length === 0) {
    // Every process that loads the ASan runtime leaks something of Node's
    // at exit, so no reports at all means ASan never ran
    console.error(`No ASan reports in ${dir}: was libasan preloaded?`);
    process.exit(1);
}

// One frame of a stack: "    #3 0x... in function file:line" or
// "    #3 0x... in function (/path/module+0x...)"
const FRAME = /^\s+#\d+ /;
// The addon's sources (src/*.cpp, src/*.h, directly: not the sanitizer's
// own src/libsanitizer/...), node-addon-api's headers compiled into it,
// or the addon's module when a frame isn't symbolized
const ADDON = /\bsrc\/(platform\/)?\w+\.(cpp|h):\d+|node-addon-api\/napi[\w-]*\.h|smartcard_napi\.node/;
// Allocating for whoever called them
const ALLOCATOR = /libsanitizer|lib(std)?c\+\+|libgcc| in (operator new|malloc|calloc|realloc)\b/;
const NODE_API = / in (napi_|node_api_|v8impl::)/;
const EXPECTED = / in napi_create_promise\b/;

// Whether the addon allocated what this leak report's stack shows
function allocatedByAddon(block) {
    for (const frame of block.split('\n').filter((line) => FRAME.test(line))) {
        if (ALLOCATOR.test(frame) || NODE_API.test(frame)) {
            continue;
        }
        return ADDON.test(frame);
    }
    return false;
}

let memoryErrors = 0;
let leaks = 0;
let expectedLeaks = 0;
const failures = [];

for (const file of files) {
    const text = fs.readFileSync(file, 'utf-8');
    const name = path.basename(file);
    if (/ERROR: AddressSanitizer/.test(text)) {
        // A memory error ends the process: report the whole log
        memoryErrors++;
        failures.push(`${name}: memory error\n${text}`);
        continue;
    }
    if (/LeakSanitizer has encountered a fatal error|LeakSanitizer does not work/.test(text)) {
        failures.push(`${name}: LeakSanitizer couldn't check for leaks\n${text}`);
        continue;
    }
    for (const block of text.split(/\n\s*\n/)) {
        if (!/^(Direct|Indirect) leak/m.test(block)) {
            continue;
        }
        leaks++;
        if (!allocatedByAddon(block)) {
            continue;
        }
        if (EXPECTED.test(block)) {
            expectedLeaks++;
            continue;
        }
        failures.push(`${name}: leak allocated by the addon\n${block.trim()}`);
    }
}

console.log(
    `${files.length} ASan reports: ${memoryErrors} with a memory error; ${leaks} leaks, ` +
        `${expectedLeaks} of them expected (unsettled promises at worker teardown); ` +
        `${failures.length} failures`
);
if (failures.length > 0) {
    console.error(`\n${failures.join('\n\n')}`);
    process.exit(1);
}
