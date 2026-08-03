// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-34(c): the ACTIVE WALLET selection must survive a re-lock, in EVERY shell.
//
// `activeWalletMemory.js` was built for this and then wired into the web shell
// only. The extension popup and the desktop renderer both kept doing what the
// module's own header describes as the bug - `setActiveWalletId(list[0].id)`
// unconditionally on every post-unlock load - and since the password is never
// persisted, that load runs on every popup close-and-reopen and every desktop
// restart. The user sees a wallet name change in the nav and nothing else;
// whatever they compose next (a send, a receive address, a mint) is signed by
// the wrong wallet.
//
// The popup is the worst case of the three: a reload is occasional, but closing
// the popup is how you use it.
//
// This is a PARITY smoke, not a behaviour test, and that is deliberate: the
// defect was never "the logic is wrong", it was "two of three shells never got
// it". The invariant is that all three read the memory before defaulting and
// all three write it on switch. Each shell is named, so a failure says which
// one drifted.
//
// Behaviour lives in test/unit/shared/activeWalletMemory.test.js.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// Three, not four: `@xchain-wallet/mobile` is a Capacitor wrapper around the
// built web SPA with "no UI of its own" (its package.json says so, and it has
// no App.jsx), so the web entry below is the mobile shell too. If mobile ever
// grows its own root component it belongs in this list.
const SHELLS = [
    { name: 'web', path: join(wsRoot, 'packages', 'web', 'src', 'App.jsx') },
    { name: 'extension popup', path: join(wsRoot, 'packages', 'extension', 'src', 'popup', 'App.jsx') },
    { name: 'desktop renderer', path: join(wsRoot, 'packages', 'desktop', 'renderer', 'App.jsx') },
];

for (const shell of SHELLS) {
    const src = readFileSync(shell.path, 'utf8');

    assert.ok(
        /import \{[^}]*readActiveWallet[^}]*\} from '@xchain-wallet\/core\/shared\/utils\/activeWalletMemory\.js'/.test(src)
        || /activeWalletMemory\.js/.test(src),
        `${shell.name}: does not import activeWalletMemory at all, so its active wallet cannot survive a re-lock`,
    );
    assert.ok(
        /readActiveWallet\(\)/.test(src),
        `${shell.name}: never calls readActiveWallet(), so the post-unlock load still picks a wallet blind`,
    );
    assert.ok(
        /writeActiveWallet\(/.test(src),
        `${shell.name}: never calls writeActiveWallet(), so switching wallets is forgotten the moment it re-locks`,
    );

    // The stored id MUST be validated against the live list before it is
    // honoured: a removed wallet, or a vault restored onto another device,
    // leaves an id that matches nothing, and selecting it would leave the app
    // pointing at a wallet that does not exist.
    assert.ok(
        /some\(\(w\) => w\.id === persisted\)/.test(src),
        `${shell.name}: honours the stored wallet id without checking it is still in the list`,
    );

    // And the picker must go through the persisting handler. Passing
    // `setActiveWalletId` straight in is exactly how the extension and desktop
    // shells looked while this defect was open: the switch worked, and was
    // forgotten.
    assert.ok(
        !/onSwitch=\{setActiveWalletId\}/.test(src),
        `${shell.name}: WalletPicker onSwitch goes straight to setActiveWalletId, so the choice is never remembered`,
    );
}

console.log(`active-wallet-memory parity smoke OK (${SHELLS.length} shells)`);
