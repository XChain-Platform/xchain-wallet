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
import { createHash } from 'node:crypto';
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

/** A gated manifest body with optional header lines, covering FILE. */
function manifest(...header) {
    return ungated('# dev-mock-gate: enforced', ...header);
}

/** The same body with no gate line unless the caller writes one. */
function ungated(...header) {
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
const BODY = Buffer.from('staged AppImage bytes');
const sha512Of = (bytes, encoding) => createHash('sha512').update(bytes).digest(encoding);
const stagedSha512 = new Map([[FILE, sha512Of(BODY, 'hex')]]);
const yml = (version, sha = sha512Of(BODY, 'base64')) =>
    `version: ${version}\nfiles:\n  - url: ${FILE}\n    sha512: ${sha}\npath: ${FILE}\nsha512: ${sha}\n`;
const lanesHeader = manifest('# coverage: partial', '# lanes: linux');
const linuxCheck = (sha, staged = stagedSha512) => checkPointers({
    pointers: [{ name: 'stable-linux.yml', text: yml('0.333.1', sha) }, { name: 'stable-linux-arm64.yml', text: yml('0.333.1') }],
    manifestText: lanesHeader, tag: 'v0.333.1', channel: 'stable', lanesText, stagedSha512: staged,
});
assert.deepEqual(linuxCheck(), [], 'a linux partial carrying exactly its two pointers passes');
assert.deepEqual(linuxCheck(sha512Of(BODY, 'hex')), [], 'a hex sha512 passes, as the client accepts it');
assert.match(linuxCheck(sha512Of(Buffer.from('another build'), 'base64')).join('\n'),
    /^stable-linux\.yml: sha512 for .* is not the staged file's/m, 'a pointer from another build of the version is refused');
assert.match(linuxCheck('x').join('\n'), /^stable-linux\.yml: carries no sha512/m, 'a malformed sha512 is refused');
assert.match(linuxCheck(undefined, new Map()).join('\n'), /not in the release directory/, 'an unstaged file is refused');
assert.match(linuxCheck(undefined, null).join('\n'), /not in the release directory/, 'no staged hashes fails shut');
const refused = checkPointers({
    pointers: [{ name: 'stable-linux.yml', text: yml('0.333.1') }, { name: 'stable-mac.yml', text: yml('0.333.1') }],
    manifestText: lanesHeader, tag: 'v0.333.1', channel: 'stable', lanesText, stagedSha512,
});
assert.ok(refused.some((p) => /^stable-linux-arm64\.yml: missing/.test(p)), `the missing arm64 pointer is named:\n${refused.join('\n')}`);
assert.ok(refused.some((p) => /^stable-mac\.yml: unexpected/.test(p)), `the out-of-scope mac pointer is named:\n${refused.join('\n')}`);
const stray = checkPointers({
    pointers: [{ name: 'stable-linux.yml', text: yml('0.333.1') }],
    manifestText: manifest('# coverage: partial', '# lanes: android'), tag: 'v0.333.1', channel: 'stable', lanesText, stagedSha512,
});
assert.ok(stray.some((p) => /^stable-linux\.yml: unexpected/.test(p)),
    `a store-only partial carrying a stray desktop pointer is refused, not uploaded:\n${stray.join('\n')}`);
assert.match(checkPointers({ pointers: [], manifestText: manifest('# lanes:'), tag: 'v0.333.1', channel: 'stable', lanesText })
    .join('\n'), /names no lane/, 'an empty lanes header is a refusal');
assert.match(checkPointers({ pointers: [], manifestText: manifest(), tag: 'v0.333.1', channel: 'stable', lanesText: '# nothing\n' })
    .join('\n'), /declares no lanes/, 'an empty lane list is a refusal');

// The dev-mock gate, read the way updateVerify.js reads it: only `enforced` passes.
const linuxPair = [{ name: 'stable-linux.yml', text: yml('0.333.1') }, { name: 'stable-linux-arm64.yml', text: yml('0.333.1') }];
const gateCheck = (text) => checkPointers({ pointers: linuxPair, manifestText: text, tag: 'v0.333.1', channel: 'stable', lanesText, stagedSha512 });
assert.match(gateCheck(ungated('# dev-mock-gate: SKIPPED', '# coverage: partial', '# lanes: linux')).join('\n'),
    /dev-mock gate as 'SKIPPED', not 'enforced'/, 'a linux partial signed with the gate skipped is refused before upload');
assert.match(gateCheck(ungated('# coverage: partial', '# lanes: linux')).join('\n'),
    /dev-mock gate as 'unrecorded', not 'enforced'/, 'a manifest that records no gate is refused as unrecorded');
assert.match(gateCheck(ungated('# dev-mock-gate:enforced', '# coverage: partial', '# lanes: linux')).join('\n'),
    /dev-mock gate as 'unrecorded'/, 'a gate line the client cannot split (no space after the colon) does not pass');
assert.deepEqual(checkPointers({
    pointers: [], manifestText: ungated('# dev-mock-gate: SKIPPED', '# coverage: partial', '# lanes: android'),
    tag: 'v0.333.1', channel: 'stable', lanesText,
}), [], 'a store-only partial with no pointer is not judged on the updater gate');

console.log('pointer-gate.smoke.js: ok');
