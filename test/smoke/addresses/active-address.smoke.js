// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Smoke: one active (operating) address per chain. The Addresses list drops
// the type bubble for a green "Active" bubble, the detail view sets the
// active address, Home's balance is scoped to the active address, and the
// host + shells expose addresses.active / addresses.setActive.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// --- AddressList: type bubble gone, Active bubble wired -------------------
const al = read('packages/core/src/shared/routes/AddressList.jsx');
assert.ok(!/addrTypeClass/.test(al), 'AddressList no longer renders the address-type bubble');
assert.ok(/const isActiveRow =/.test(al), 'AddressList computes isActiveRow');
assert.ok(/local\.addrActive/.test(al), 'AddressList renders the green Active bubble');
assert.ok(/messaging\.getActiveAddresses\(walletId, accountId\)/.test(al),
    'AddressList fetches the resolved active map');
assert.ok(/onClick=\{setAsActive\}/.test(al) && /messaging\.setActiveAddress\(accountId, selected\.chainId, selected\.record\.id\)/.test(al),
    'the detail "Use" action makes the address active via messaging.setActiveAddress');

// --- Home / BalanceList: balance scoped to the active address ------------
const balanceList = read('packages/core/src/shared/components/BalanceList.jsx');
assert.ok(/export function buildBalanceRows\(balances, chainRegistry, activeByChain = null\)/.test(balanceList),
    'buildBalanceRows takes an activeByChain param');
assert.ok(/if \(activeAddr && entry\.address !== activeAddr\) continue/.test(balanceList),
    'buildBalanceRows skips non-active addresses when activeByChain is set');
const home = read('packages/core/src/shared/routes/Home.jsx');
assert.ok(/activeByChain=\{activeByChain\}/.test(home), 'Home passes activeByChain to HomeTabs');
assert.ok(/messaging\.getActiveAddresses\(walletId, accountId\)/.test(home),
    'Home fetches the active map for the loaded account');

// --- Send: defaults the from-address to the active address ---------------
const send = read('packages/core/src/shared/routes/Send.jsx');
assert.ok(/const activeId = activeByChain\[chainId\]\?\.id/.test(send)
    && /setFromAddressId\(activeId\)/.test(send),
    'Send defaults the from-address to the chain active address');

// --- Host routes ---------------------------------------------------------
const host = read('packages/extension/src/background/createBackgroundHost.js');
assert.ok(/host\.register\('addresses\.active'/.test(host), 'host registers addresses.active');
assert.ok(/host\.register\('addresses\.setActive'/.test(host), 'host registers addresses.setActive');

// --- Shell messaging (all three) -----------------------------------------
for (const p of [
    'packages/web/src/messaging.js',
    'packages/extension/src/popup/messaging.js',
    'packages/desktop/renderer/messaging.js',
]) {
    const src = read(p);
    assert.ok(/export function getActiveAddresses\(/.test(src), `${p} exports getActiveAddresses`);
    assert.ok(/export function setActiveAddress\(/.test(src), `${p} exports setActiveAddress`);
}

console.log('active-address smoke OK');
