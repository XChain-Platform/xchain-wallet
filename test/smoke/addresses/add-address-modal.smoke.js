// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Smoke: the "Add address" affordance opens a batch-generate page with
// four fields (coin, type, purpose, count) and derives that many
// addresses sequentially, as receive or dispenser addresses per the
// selected purpose.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sharedRoutes = join(here, '..', '..', '..', 'packages', 'core', 'src', 'shared', 'routes');

const modalPath = join(sharedRoutes, 'AddAddressModal.jsx');
assert.ok(existsSync(modalPath), 'AddAddressModal.jsx exists');
const modal = readFileSync(modalPath, 'utf8');

// Four fields: coin (icon-bearing ChainPicker), type, purpose, number
// of addresses.
assert.ok(/<ChainPicker\b/.test(modal) && /label="Coin"/.test(modal),
    'modal has a Coin field rendered via ChainPicker (shows coin icons)');
assert.ok(/>Type</.test(modal), 'modal has a Type field');
assert.ok(/>Purpose</.test(modal), 'modal has a Purpose field');
assert.ok(/>Number of addresses</.test(modal), 'modal has a count field');

// Purpose offers receive (default) and dispenser, and only renders when
// the shell's messaging exposes generateDispenserAddress.
assert.ok(/useState\(\/\*\* @type \{'receive' \| 'dispenser'\} \*\/ \('receive'\)\)/.test(modal),
    'purpose defaults to receive');
assert.ok(/value="receive"/.test(modal) && /value="dispenser"/.test(modal),
    'purpose offers Receive and Dispenser options');
assert.ok(/typeof messaging\.generateDispenserAddress === 'function'/.test(modal),
    'the Purpose field is gated on the shell exposing generateDispenserAddress');

// Coin options come from the account's chains; type options follow the
// selected chain's address types; changing the coin resets the type.
assert.ok(/coinOptions/.test(modal) && /chainRegistry\.get\(cid\)/.test(modal),
    'coin options derive from the account chainIds via the registry');
assert.ok(/selected\?\.addressTypes/.test(modal),
    'type options follow the selected coin address types');
assert.ok(/function changeCoin/.test(modal) && /defaultAddressType/.test(modal),
    'changing the coin resets the type to that chain default');

// Sequential batch generation (parallel would race on the next BIP44
// index), branching to the dispenser flow when that purpose is picked.
assert.ok(/for \(let i = 0; i < n; i \+= 1\)/.test(modal),
    'generates count addresses in a sequential loop');
assert.ok(/purpose === 'dispenser'[\s\S]*?messaging\.generateDispenserAddress[\s\S]*?messaging\.generateReceiveAddress/.test(modal),
    'the generate call branches on purpose between dispenser and receive flows');
assert.ok(/await generate\(\{ walletId, chainId, accountId, addressType \}\)/.test(modal),
    'each iteration awaits the selected flow with walletId + chainId + accountId + addressType');

// Page semantics (0375b8f): renders as its own Screen with a back-arrow
// PageHeader, same pattern as Import address, not an overlay dialog.
assert.ok(/<Screen variant=\{variant\} header=\{header\}>/.test(modal)
    && /<PageHeader[\s\S]*?title="Add addresses"/.test(modal),
    'renders as a page with a back-navigable header');

// AddressList opens the modal from the "Add address" menu item and
// refreshes the list after a successful batch.
const alPath = join(sharedRoutes, 'AddressList.jsx');
const al = readFileSync(alPath, 'utf8');
assert.ok(/import \{ AddAddressModal[^}]*\}/.test(al), 'AddressList imports AddAddressModal');
assert.ok(/setShowAddModal\(true\)/.test(al), 'the Add-address menu item opens the modal');
assert.ok(/<AddAddressModal[\s\S]*?onGenerated=\{\(\) => setReloadKey/.test(al),
    'AddressList renders the modal and refreshes the list on generate');

console.log('add-address-modal smoke OK');
