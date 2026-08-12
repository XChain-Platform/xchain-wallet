// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

//`flows/_importedAddressIds.js` exists because the "imported
// WIF addresses carry accountId=null" rule (§11.3.3) had already shipped
// wrong five times in five files (D-54, D-63, D-65 x2, D-66). Its header
// calls itself "the one place that knows the rule" - and it was not:
// `addresses.byChain` in the background host, the query AddressList
// actually calls, had restated the rule inline. Both copies said the same
// thing, so nothing was visibly broken; what was broken was the claim
// that fixing the resolver fixes the wallet.
//
// The sibling file addressesByChainImportedWif.test.js pins the
// behaviour, and a copy of the rule satisfies it just as well as a call
// does - that is exactly how the sixth copy stayed invisible. So this
// file pins the WIRING instead: it replaces the shared resolver and
// asserts the host's answer changes with it. A future inline copy passes
// every behavioural test and fails these two.
//
// The falsification that found the bug (empty the resolver, expect the
// guard to go red) is the first case here, at unit speed - no regtest
// venue and no browser needed to notice the drift.

import { describe, it, expect, vi } from 'vitest';

const importedAddressIdsFor = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/_importedAddressIds.js', () => ({
    importedAddressIdsFor,
}));

const { makeHost, byChain, addressesOn } = await import('./_addressesByChainFixture.js');

describe('Addresses.byChain reads the imported-key rule, never restates it', () => {
    it('lists no imported address when the shared resolver returns none', async () => {
        // The wallet record still says addr-wif is imported. Only the
        // resolver changed, so an inline re-read of `importedKeys` keeps
        // listing it and this case fails.
        importedAddressIdsFor.mockResolvedValue(new Set());
        const addresses = addressesOn(await byChain(makeHost(), { walletId: 'w1' }));
        expect(addresses).toEqual(['n2XDwu']);
    });

    it('lists whatever the shared resolver claims, not what importedKeys says', async () => {
        // Inverse direction: the wallet record does NOT link addr-wif-other,
        // so only a genuine delegation surfaces it. Pinning both directions
        // means neither a stale copy nor a coincidence can pass.
        importedAddressIdsFor.mockResolvedValue(new Set(['addr-wif-other']));
        const addresses = addressesOn(await byChain(makeHost(), { walletId: 'w1' }));
        expect(addresses).toContain('mOTHER');
        expect(addresses).not.toContain('mq1XCn');
    });

    it('asks the resolver for the WALLET, never narrowed to the requested account', async () => {
        // An imported key belongs to no account, so passing an accountId
        // down would exclude it from every account-scoped query. That was
        // the first, wrong version of D-63.
        importedAddressIdsFor.mockResolvedValue(new Set(['addr-wif']));
        await byChain(makeHost(), { walletId: 'w1', accountId: 'acct-1' });
        expect(importedAddressIdsFor).toHaveBeenCalled();
        for (const call of importedAddressIdsFor.mock.calls) {
            expect(call[1]).toBe('w1');
            expect(call).not.toContain('acct-1');
        }
    });
});
