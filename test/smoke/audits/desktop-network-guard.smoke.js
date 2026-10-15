// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Desktop test launches stay under the test network guard.
//
// Two desktop test runs reached hub.xchain.io and explorer.xchain.io: their
// network block rode in NODE_OPTIONS, which Playwright's electron.launch
// drops. The block now lives in the app (packages/desktop/main/
// networkGuard.js) and test/e2e/fixtures/electron.js turns it on for every
// launch. This audit keeps it that way: no test file under test/ calls
// electron.launch except that fixture, and the guard is still the first
// thing the main entry imports, ahead of every module that can open a
// connection or a window.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const FIXTURE = 'test/e2e/fixtures/electron.js';

function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name.startsWith('test-results')) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, out);
        else if (/\.(?:c|m)?js$/.test(entry.name)) out.push(path);
    }
    return out;
}

const LAUNCH_RE = /\belectron\.launch\s*\(/;
const unguarded = walk(join(root, 'test'))
    .map((path) => relative(root, path).split('\\').join('/'))
    .filter((rel) => rel !== FIXTURE && rel !== 'test/smoke/audits/desktop-network-guard.smoke.js')
    .filter((rel) => LAUNCH_RE.test(readFileSync(join(root, rel), 'utf8')));
assert.deepEqual(unguarded, [],
    `these test files launch Electron without the network guard; use launchGuardedElectron from ${FIXTURE}`);

const fixture = readFileSync(join(root, FIXTURE), 'utf8');
assert.match(fixture, /electron\.launch\(guardedLaunchOptions\(/,
    'the fixture launches through guardedLaunchOptions');

const entry = readFileSync(join(root, 'packages', 'desktop', 'main', 'index.js'), 'utf8');
const firstImport = entry.match(/^import\s[^;]*?from\s+'([^']+)';/m)?.[1];
assert.equal(firstImport, './networkGuardBoot.js',
    'the desktop main entry imports the network guard before any other module');

console.log('OK: desktop test launches run under the network guard, which the main entry loads first');
