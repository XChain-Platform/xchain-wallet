// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §17.7 / G027: ViewPrivateKey wired into every shell's
// App.jsx via the AddressList "Show key" affordance. Cluster E
// Step 4 of 5.
//
// Desktop is in the loop because it drifted out of it: it shipped the
// exportPrivateKey IPC with no UI consumer, so the shared Secret
// button rendered permanently greyed there.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const routes = join(core, 'src', 'shared', 'routes');

// --- 1. AddressList exposes onShowPrivateKey + renders the button -------

const al = readFileSync(join(routes, 'AddressList.jsx'), 'utf8');
assert.ok(/onShowPrivateKey/.test(al),
    'AddressList accepts an onShowPrivateKey prop');
assert.ok(/Secret/.test(al),
    'AddressList renders a "Secret" reveal affordance');
// Multisig synthetic rows must NOT get the reveal button; the detail-view
// gating expression (canSecret) requires selected.record AND !selected.multisig.
assert.ok(/onShowPrivateKey\s*&&\s*selected\.record\s*&&\s*!selected\.multisig/.test(al),
    'AddressList only enables the Secret button for non-multisig rows with a record');
// A shell that wired no handler gets no button at all, rather than one
// that can never activate (the onReceive gating rule in the same file).
assert.ok(/\{onShowPrivateKey \? \([\s\S]{0,600}?<span>Secret<\/span>/.test(al),
    'AddressList renders the Secret button only when a handler was supplied');

// --- 2. Every shell imports + renders ViewPrivateKey --------------------

for (const [name, file] of [
    ['extension', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    assert.ok(existsSync(file), `${name} App.jsx exists`);
    const src = readFileSync(file, 'utf8');
    assert.ok(
        /from ['"]@xchain-wallet\/core\/shared\/routes\/ViewPrivateKey\.jsx['"]/.test(src),
        `${name} App imports ViewPrivateKey`,
    );
    assert.ok(/unlockedView === ['"]view-private-key['"]/.test(src),
        `${name} App routes unlockedView "view-private-key" to ViewPrivateKey`);
    assert.ok(/setPrivateKeyAddress\(addr\)/.test(src)
        || /setPrivateKeyAddress\(\s*addr\s*\)/.test(src),
        `${name} App stages the address via setPrivateKeyAddress`);
    assert.ok(/onShowPrivateKey=\{/.test(src),
        `${name} App passes onShowPrivateKey to AddressList`);
    // The View → Back path must clear the staged address so a stale
    // address can't leak into a later visit.
    assert.ok(/setPrivateKeyAddress\(\s*null\s*\)/.test(src),
        `${name} App clears privateKeyAddress on back`);
}

console.log('view-private-key-wiring smoke OK');
