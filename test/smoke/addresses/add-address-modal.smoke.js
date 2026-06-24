// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Smoke: the "Add address" affordance opens a batch-generate modal with
// three fields (coin, type, count) and derives that many receive
// addresses sequentially.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sharedRoutes = join(here, '..', '..', '..', 'packages', 'core', 'src', 'shared', 'routes');

const modalPath = join(sharedRoutes, 'AddAddressModal.jsx');
assert.ok(existsSync(modalPath), 'AddAddressModal.jsx exists');
const modal = readFileSync(modalPath, 'utf8');

// Three fields: coin (icon-bearing ChainPicker), type, number of addresses.
assert.ok(/<ChainPicker\b/.test(modal) && /label="Coin"/.test(modal),
    'modal has a Coin field rendered via ChainPicker (shows coin icons)');
assert.ok(/>Type</.test(modal), 'modal has a Type field');
assert.ok(/>Number of addresses</.test(modal), 'modal has a count field');

// Coin options come from the account's chains; type options follow the
// selected chain's address types; changing the coin resets the type.
assert.ok(/coinOptions/.test(modal) && /chainRegistry\.get\(cid\)/.test(modal),
    'coin options derive from the account chainIds via the registry');
assert.ok(/selected\?\.addressTypes/.test(modal),
    'type options follow the selected coin address types');
assert.ok(/function changeCoin/.test(modal) && /defaultAddressType/.test(modal),
    'changing the coin resets the type to that chain default');

// Sequential batch generation via generateReceiveAddress (parallel would
// race on the next BIP44 index).
assert.ok(/for \(let i = 0; i < n; i \+= 1\)/.test(modal),
    'generates count addresses in a sequential loop');
assert.ok(/await messaging\.generateReceiveAddress\(\{[\s\S]*?chainId,[\s\S]*?addressType[\s\S]*?\}\)/.test(modal),
    'each iteration awaits generateReceiveAddress with chainId + addressType');

// Overlay modal semantics.
assert.ok(/role="dialog"/.test(modal) && /aria-modal="true"/.test(modal),
    'renders as an accessible modal dialog');

// AddressList opens the modal from the "Add address" menu item and
// refreshes the list after a successful batch.
const alPath = join(sharedRoutes, 'AddressList.jsx');
const al = readFileSync(alPath, 'utf8');
assert.ok(/import \{ AddAddressModal \}/.test(al), 'AddressList imports AddAddressModal');
assert.ok(/setShowAddModal\(true\)/.test(al), 'the Add-address menu item opens the modal');
assert.ok(/<AddAddressModal[\s\S]*?onGenerated=\{\(\) => setReloadKey/.test(al),
    'AddressList renders the modal and refreshes the list on generate');

console.log('add-address-modal smoke OK');
