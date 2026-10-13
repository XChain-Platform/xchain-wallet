// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for tools/release/pointer-gate.mjs: which pointer set a signed
// manifest's header demands. publish-feed.smoke.js drives the gate through
// publish.sh on a full release; this covers the scopes that fixture cannot
// reach without a second signing setup: partials, rehearsals, and the lists
// the gate must refuse to read.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkPointers, expectedPointers, manifestScope, parseLaneFeeds }
    from '../../../tools/release/pointer-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const lanesText = readFileSync(join(here, '..', '..', '..', 'tools', 'release', 'shipped-lanes.txt'), 'utf8');
const laneFeeds = parseLaneFeeds(lanesText);

const FILE = 'xchain-wallet-0.333.1-x86_64.AppImage';
const HASH = 'a'.repeat(64);

/** A manifest body with optional header lines, covering FILE. */
function manifest(...header) {
    return ['# XChain Wallet release manifest', '# tag: v0.333.1', ...header, `${HASH}  ${FILE}`, ''].join('\n');
}

/** The expected set for a manifest, sorted, plus any refusal. */
function expectFor(manifestText, channel = 'stable') {
    const scope = manifestScope(manifestText, laneFeeds);
    const { names, problems } = expectedPointers({ channel, lanes: scope.lanes, laneFeeds });
    return { names: [...names].sort(), problems };
}

// A full release: every updater lane in shipped-lanes.txt, so all four pointers.
assert.deepEqual(expectFor(manifest()),
    { names: ['stable-linux-arm64.yml', 'stable-linux.yml', 'stable-mac.yml', 'stable.yml'], problems: [] },
    'a manifest with no scope header demands all four desktop pointers');

// The shape every desktop release so far has had: a mac and linux partial.
assert.deepEqual(expectFor(manifest('# coverage: partial', '# lanes: mac linux')),
    { names: ['stable-linux-arm64.yml', 'stable-linux.yml', 'stable-mac.yml'], problems: [] },
    'a mac+linux partial demands the three pointers its lanes emit, not the Windows one');

// A store lane adds nothing; the updater lane beside it still counts.
assert.deepEqual(expectFor(manifest('# coverage: partial', '# lanes: android linux')),
    { names: ['stable-linux-arm64.yml', 'stable-linux.yml'], problems: [] },
    'android is store-only and adds no pointer to a mixed partial');
assert.deepEqual(expectFor(manifest('# coverage: partial', '# lanes: android')),
    { names: [], problems: [] },
    'a store-only partial expects no desktop pointer at all');

// A scoped rehearsal names OSes, which are lane names here.
assert.deepEqual(expectFor(manifest('# rehearsal-os: mac'), 'staging'),
    { names: ['staging-mac.yml'], problems: [] },
    'a mac rehearsal demands only the staging mac pointer');

// Fail shut on scopes the lane list cannot answer.
assert.match(expectFor(manifest('# lanes: plan9')).problems.join('\n'), /lane "plan9", which shipped-lanes\.txt does not declare/,
    'a lane the list does not declare is a refusal, not an empty set');
const futureFeeds = parseLaneFeeds(`${lanesText}\nfreebsd   NOT-SHIPPED  updater     *.pkg\n`);
assert.match(expectedPointers({ channel: 'stable', lanes: ['freebsd'], laneFeeds: futureFeeds }).problems.join('\n'),
    /lane "freebsd" updates through the feed, but no channel pointer is mapped for it/,
    'an updater lane with no pointer mapping is refused rather than demanding nothing');
assert.throws(() => parseLaneFeeds('mac SHIPPED\n'), /cannot read the feed/,
    'a lane row with no feed column is unreadable, not skipped');

// The whole check, through checkPointers: missing and unexpected are both named.
const yml = (version) => `version: ${version}\nfiles:\n  - url: ${FILE}\n    sha512: x\npath: ${FILE}\nsha512: x\n`;
const lanesHeader = manifest('# coverage: partial', '# lanes: linux');
assert.deepEqual(checkPointers({
    pointers: [{ name: 'stable-linux.yml', text: yml('0.333.1') }, { name: 'stable-linux-arm64.yml', text: yml('0.333.1') }],
    manifestText: lanesHeader, tag: 'v0.333.1', channel: 'stable', lanesText,
}), [], 'a linux partial carrying exactly its two pointers passes');
const refused = checkPointers({
    pointers: [{ name: 'stable-linux.yml', text: yml('0.333.1') }, { name: 'stable-mac.yml', text: yml('0.333.1') }],
    manifestText: lanesHeader, tag: 'v0.333.1', channel: 'stable', lanesText,
});
assert.ok(refused.some((p) => /^stable-linux-arm64\.yml: missing/.test(p)), `the missing arm64 pointer is named:\n${refused.join('\n')}`);
assert.ok(refused.some((p) => /^stable-mac\.yml: unexpected/.test(p)), `the out-of-scope mac pointer is named:\n${refused.join('\n')}`);
const stray = checkPointers({
    pointers: [{ name: 'stable-linux.yml', text: yml('0.333.1') }],
    manifestText: manifest('# coverage: partial', '# lanes: android'), tag: 'v0.333.1', channel: 'stable', lanesText,
});
assert.ok(stray.some((p) => /^stable-linux\.yml: unexpected/.test(p)),
    `a store-only partial carrying a stray desktop pointer is refused, not uploaded:\n${stray.join('\n')}`);
assert.match(checkPointers({ pointers: [], manifestText: manifest('# lanes:'), tag: 'v0.333.1', channel: 'stable', lanesText })
    .join('\n'), /names no lane/, 'an empty lanes header is a refusal');
assert.match(checkPointers({ pointers: [], manifestText: manifest(), tag: 'v0.333.1', channel: 'stable', lanesText: '# nothing\n' })
    .join('\n'), /declares no lanes/, 'an empty lane list is a refusal');

console.log('pointer-gate.smoke.js: ok');
