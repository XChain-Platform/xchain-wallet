// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Wallet E2E session 16 / D-63, at the host boundary: `importWif` writes
// its Address record with accountId=null (§11.3.3's carve-out for
// imported keys), while `addresses.byChain` kept only addresses whose
// accountId matched an account of the wallet. The two halves of one
// convention disagreed, so every WIF-imported key was invisible on every
// surface that reads this map - the function's own comment lists Home,
// History, AddressList, Send and every action form's chain picker. The
// import reported success and named the right address, and the address
// then appeared nowhere.
//
// Same shape: the allocating side and the selecting side have
// to agree, so both directions are pinned here.
//
// This file pins the BEHAVIOUR. Its sibling addressesByChainSharedRule
// pins where the behaviour comes from, which is the half that kept
// regressing.

import { describe, it, expect } from 'vitest';
import { makeHost, byChain, addressesOn } from './_addressesByChainFixture.js';

describe('D-63: addresses.byChain surfaces imported-WIF addresses', () => {
    it('includes the imported key alongside the HD addresses', async () => {
        const addresses = addressesOn(await byChain(makeHost(), { walletId: 'w1' }));
        expect(addresses).toContain('n2XDwu');
        expect(addresses).toContain('mq1XCn');
    });

    it('never leaks another wallet\'s imported key', async () => {
        const addresses = addressesOn(await byChain(makeHost(), { walletId: 'w1' }));
        expect(addresses).not.toContain('mOTHER');
    });

    it('still includes the imported key when one account is requested', async () => {
        // Imported keys are wallet-scoped, not account-scoped, and
        // AddressList always passes the active account id - excluding them
        // here was the first, wrong version of this fix: it left the only
        // consumer that matters exactly as broken as before.
        const addresses = addressesOn(await byChain(makeHost(), { walletId: 'w1', accountId: 'acct-1' }));
        expect(addresses).toContain('n2XDwu');
        expect(addresses).toContain('mq1XCn');
    });

    it('still returns the HD addresses when the wallet has no imported keys', async () => {
        const map = await byChain(makeHost({ importedKeys: [] }), { walletId: 'w1' });
        expect(addressesOn(map)).toEqual(['n2XDwu']);
    });

    it('tolerates a wallet record with no importedKeys array at all', async () => {
        const map = await byChain(makeHost({ omitImportedKeys: true }), { walletId: 'w1' });
        expect(addressesOn(map)).toEqual(['n2XDwu']);
    });
});
