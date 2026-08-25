// Runs the native C++ test binary. npm scripts run through cmd.exe on
// Windows, which cannot execute ./-prefixed paths, so spawn it from node.
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const exe = process.platform === 'win32' ? 'smartcard_tests.exe' : 'smartcard_tests';
const binary = path.join(__dirname, '..', 'build', 'Release', exe);

const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });

if (result.error) {
    console.error(`Failed to run ${binary}: ${result.error.message}`);
    process.exit(1);
}

if (result.signal) {
    console.error(`${binary} was killed by signal ${result.signal}`);
}

process.exit(result.status === null ? 1 : result.status);
