// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §48.5 / Cluster Q FOLLOWUP 5 — logConsole persistent mirror.
//
// Pins:
//   1. logConsole exports `restore` + `attachMirror` + `detachMirror` +
//      `isMirrorAttached`; the FOLLOWUP-shape default sourceAllow predicate
//      includes vault / signer:* / encoder / bridge:* and excludes console.
//   2. `restore(entries)` splices persisted entries into the front of the
//      buffer chronologically, doesn't re-fire listeners, and dedupes by id.
//   3. `attachMirror({save})` debounces save calls and only forwards
//      whitelisted sources. `detachMirror` removes the subscription.
//   4. `packages/extension/src/background/logConsoleStorage.js` exists and
//      exports `createLogConsoleStorage` with the chrome.storage.local /
//      localStorage / null fallback shape.
//   5. createBackgroundHost imports the adapter, threads it through deps,
//      hydrates via `logConsole.restore`, then attaches the mirror.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    logConsole,
    __mirrorTestUtils,
} from '../../../packages/core/src/shared/utils/logConsole.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// ─── 1. surface ─────────────────────────────────────────────────────────

const utilSrc = readFileSync(
    join(wsRoot, 'packages/core/src/shared/utils/logConsole.js'),
    'utf8',
);
for (const sym of ['restore', 'attachMirror', 'detachMirror', 'isMirrorAttached']) {
    assert.ok(new RegExp(`\\b${sym}\\b`).test(utilSrc), `logConsole exposes ${sym}`);
}
assert.equal(typeof logConsole.restore, 'function', 'restore is callable');
assert.equal(typeof logConsole.attachMirror, 'function', 'attachMirror is callable');
assert.equal(typeof logConsole.detachMirror, 'function', 'detachMirror is callable');
assert.equal(typeof logConsole.isMirrorAttached, 'function', 'isMirrorAttached is callable');

// Default sourceAllow predicate matches the FOLLOWUP shape.
const allow = __mirrorTestUtils.defaultSourceAllow;
assert.equal(allow('vault'), true, 'vault is mirrored');
assert.equal(allow('encoder'), true, 'encoder is mirrored');
assert.equal(allow('signer:software'), true, 'signer:software is mirrored');
assert.equal(allow('signer:hardware'), true, 'signer:hardware is mirrored');
assert.equal(allow('bridge:connect'), true, 'bridge:* is mirrored');
assert.equal(allow('bridge:signMessage'), true, 'bridge:signMessage is mirrored');
assert.equal(allow('console'), false, 'console is NEVER mirrored');
assert.equal(allow('app'), false, 'unknown source default-rejected');
assert.equal(allow(''), false, 'empty source rejected');
assert.equal(allow(undefined), false, 'undefined source rejected');

// ─── 2. restore behavior ────────────────────────────────────────────────

logConsole.detachMirror();
logConsole.clear();
logConsole.record({ source: 'vault', message: 'live-1', level: 'log' });
const liveBefore = logConsole.entries();
assert.equal(liveBefore.length, 1, 'one live entry');

let listenerFired = 0;
const unsub = logConsole.subscribe(() => { listenerFired += 1; });
logConsole.restore([
    { id: 9001, timestamp: Date.now() - 5000, level: 'log', source: 'vault', message: 'persisted-A' },
    { id: 9002, timestamp: Date.now() - 4000, level: 'warn', source: 'encoder', message: 'persisted-B' },
]);
unsub();
assert.equal(listenerFired, 0, 'restore() does NOT fire listeners');

const liveAfter = logConsole.entries();
assert.equal(liveAfter.length, 3, 'restore prepends persisted entries');
assert.equal(liveAfter[0].message, 'persisted-A', 'oldest persisted entry first');
assert.equal(liveAfter[1].message, 'persisted-B', 'second persisted entry');
assert.equal(liveAfter[2].message, 'live-1', 'live entry kept');

// Re-restore with overlapping id should dedupe.
logConsole.restore([
    { id: 9001, timestamp: Date.now() - 5000, level: 'log', source: 'vault', message: 'persisted-A-dupe' },
    { id: 9003, timestamp: Date.now() - 3000, level: 'log', source: 'vault', message: 'persisted-C' },
]);
const liveDeduped = logConsole.entries();
const aCount = liveDeduped.filter((e) => e.message === 'persisted-A-dupe').length;
assert.equal(aCount, 0, 'duplicate id is rejected (dedupe by id)');
assert.ok(liveDeduped.some((e) => e.message === 'persisted-C'), 'new id is admitted');

// ─── 3. attachMirror behavior ───────────────────────────────────────────

logConsole.clear();
const saved = [];
logConsole.attachMirror({
    save: (entries) => { saved.push(entries); },
    debounceMs: 0,
});
assert.equal(logConsole.isMirrorAttached(), true, 'mirror is attached');

logConsole.record({ source: 'vault', message: 'real-1' });
logConsole.record({ source: 'console', message: 'should-not-mirror' });
logConsole.record({ source: 'bridge:signAction', message: 'real-2' });

// Allow the debounced (0ms) flush to settle.
await new Promise((r) => setTimeout(r, 5));

assert.ok(saved.length >= 1, `at least one save() fired (got ${saved.length})`);
const lastSave = saved[saved.length - 1];
assert.ok(Array.isArray(lastSave), 'save receives an array');
const sources = lastSave.map((e) => e.source);
assert.ok(sources.includes('vault'), 'vault entry mirrored');
assert.ok(sources.includes('bridge:signAction'), 'bridge:* entry mirrored');
assert.ok(!sources.includes('console'), 'console entry NOT mirrored');

logConsole.detachMirror();
assert.equal(logConsole.isMirrorAttached(), false, 'mirror detaches');

const savesBefore = saved.length;
logConsole.record({ source: 'vault', message: 'after-detach' });
await new Promise((r) => setTimeout(r, 5));
assert.equal(saved.length, savesBefore, 'no save fires after detach');

logConsole.clear();

// ─── 4. logConsoleStorage adapter ───────────────────────────────────────

const storagePath = join(
    wsRoot, 'packages', 'extension', 'src', 'background', 'logConsoleStorage.js',
);
assert.ok(existsSync(storagePath), 'logConsoleStorage.js exists');
const storageSrc = readFileSync(storagePath, 'utf8');

assert.match(storageSrc, /export function createLogConsoleStorage\(\)/,
    'createLogConsoleStorage is a named export');
assert.match(storageSrc, /chrome\?\.storage\?\.local/, 'extension SW path uses chrome.storage.local');
assert.match(storageSrc, /typeof localStorage !== 'undefined'/, 'web/desktop path uses localStorage');
assert.match(storageSrc, /xchain\.logConsole/, 'storage key namespaced under xchain.logConsole');
assert.match(storageSrc, /function coerceEntries/, 'defensive coerce of persisted shape');
assert.match(storageSrc, /Number\.isFinite\(raw\.id\)/, 'coerce drops entries without finite id');
assert.match(storageSrc, /ALLOWED_LEVELS/, 'coerce checks level whitelist');

// ─── 5. createBackgroundHost wiring ─────────────────────────────────────

const hostSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);

assert.match(
    hostSrc,
    /import \{ createLogConsoleStorage \} from '\.\/logConsoleStorage\.js'/,
    'host imports createLogConsoleStorage',
);
assert.match(
    hostSrc,
    /logConsoleStorage = createLogConsoleStorage\(\)/,
    'logConsoleStorage default = createLogConsoleStorage()',
);
assert.match(hostSrc, /logConsole\.restore\(persisted\)/,
    'host hydrates buffer via logConsole.restore');
assert.match(hostSrc, /logConsole\.attachMirror\(\{[\s\S]+?save: \(entries\) => logConsoleStorage\.save\(entries\)/,
    'host attaches the mirror with save = storage.save');

console.log('OK — logConsole mirror surface + storage adapter + host wiring');
