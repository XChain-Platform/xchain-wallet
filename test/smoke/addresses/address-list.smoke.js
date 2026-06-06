// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §56.3 Pre-launch Step 2 of 7 — Standalone AddressList route
// (Phase 4 FOLLOWUP 4 from 2026-04-24_phase4-close.md).

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

// ─── AddressList route file ───────────────────────────────────

const routePath = join(sharedRoutes, 'AddressList.jsx');
assert.ok(existsSync(routePath), 'AddressList.jsx exists');
const route = readFileSync(routePath, 'utf8');

assert.ok(/export function AddressList\b/.test(route),
    'AddressList is a named export');
assert.ok(/messaging\.getAddressesByChain/.test(route),
    'AddressList aggregates addresses across chains via getAddressesByChain');
assert.ok(/messaging\.getMultisigReceiveAddress/.test(route),
    'AddressList resolves the multisig receive address for badging');
assert.ok(/MultisigBadge/.test(route),
    'AddressList imports MultisigBadge');
assert.ok(/<MultisigBadge[\s\S]*?threshold=\{(?:row\.)?multisig\.threshold\}/.test(route),
    'AddressList renders the badge inline on matching rows');
assert.ok(/Multisig only/.test(route),
    'AddressList exposes a "Multisig only" filter chip');
assert.ok(/multisigOnly/.test(route),
    'AddressList tracks a multisigOnly filter state');
assert.ok(/aria-label="Address filters"/.test(route),
    'AddressList filter bar is labeled for assistive tech');
assert.ok(/aria-label="Wallet addresses"/.test(route),
    'AddressList row container is labeled');
assert.ok(/Multisig receive/.test(route),
    'AddressList synthesizes a "Multisig receive" row when the address is not in the persisted table');

// ─── Home — new onAddresses nav prop + button ─────────────────

const home = readFileSync(join(sharedRoutes, 'Home.jsx'), 'utf8');
assert.ok(/\bonAddresses\b/.test(home),
    'Home accepts an onAddresses nav prop');
assert.ok(/onClick=\{onAddresses\}[\s\S]*?disabled=\{!onAddresses\}/.test(home)
    || /disabled=\{!onAddresses\}[\s\S]*?onClick=\{onAddresses\}/.test(home),
    'Home renders an Addresses button wired to onAddresses');
assert.ok(/Addresses/.test(home),
    'Home surfaces the "Addresses" button label');

// ─── App.jsx wiring (all three shells) ────────────────────────

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('AddressList'),
        `${shell} App.jsx imports AddressList`);
    assert.ok(app.includes("'addresses'"),
        `${shell} tracks 'addresses' sub-route`);
    assert.ok(/<AddressList\b[\s\S]*?walletId=\{activeWalletId\}/.test(app),
        `${shell} App.jsx mounts <AddressList> with the active walletId`);
    assert.ok(/onAddresses=\{activeWalletId \? \(\) => setUnlockedView\('addresses'\) : undefined\}/.test(app),
        `${shell} Home receives the onAddresses nav prop`);
}

console.log(
    'OK — address-list smoke (AddressList route exists + getAddressesByChain aggregation + getMultisigReceiveAddress prefetch + MultisigBadge on matching rows + "Multisig only" filter + synthetic multisig row when not persisted + Home.onAddresses nav prop + 3-shell App.jsx wiring of \'addresses\' sub-route)',
);
