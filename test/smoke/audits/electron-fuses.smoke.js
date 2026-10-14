// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');
const require = createRequire(import.meta.url);
const config = require(join(desktop, 'electron-builder.config.cjs'));
const manifest = require(join(desktop, 'package.json'));

const electronMajor = Number.parseInt(manifest.devDependencies.electron.match(/\d+/)?.[0], 10);
assert.ok(electronMajor >= 30,
    'the packaged Electron supports embedded ASAR integrity on macOS and Windows');
assert.deepEqual(config.electronFuses, {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableCookieEncryption: true,
    enableEmbeddedAsarIntegrityValidation: true,
});

console.log('OK: desktop Electron fuses disable Node switches and protect cookies and ASAR contents');
