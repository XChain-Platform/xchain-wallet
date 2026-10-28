// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A broadcast destroy records the burned amount as a pending debit, so every
// balance read the wallet serves (another window's Approve-time re-check, Home,
// Max) nets it before the explorer indexes the burn.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'destroy-tx-1' })),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => ({
        address: from.address, publicKey: from.publicKey,
        derivationPath: from.derivationPath || null, addressId: from.addressId || null,
    })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { destroyToken } from '../../../packages/core/src/flows/destroyToken.js';
import { applyPendingBalanceDeltas } from '../../../packages/core/src/flows/balances.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const FROM = { address: 'bcrt1qsource', publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", addressId: 'a1' };
const base = (extra = {}) => ({
    vault: {}, walletId: 'w1', password: 'pw', chainRegistry: {}, sdkRegistry: {},
    chainId: 'bitcoin-regtest', from: FROM, params: { VERSION: '0', TICK: 'ART', AMOUNT: '400' }, ...extra,
});

describe('destroyToken pending debit', () => {
    beforeEach(() => submitAction.mockClear());

    it('records the burned token and amount on the pending transaction', async () => {
        await destroyToken(base());
        const meta = submitAction.mock.calls[0][0].pendingTxMeta;
        expect(meta.balanceDebits).toEqual([{ tick: 'ART', amount: '400' }]);
        expect(meta.fromAddress).toBe(FROM.address);
    });

    it('nets a live destroy from the balance another surface reads', async () => {
        await destroyToken(base());
        const meta = submitAction.mock.calls[0][0].pendingTxMeta;
        const byChain = {
            'bitcoin-regtest': [{
                address: FROM.address,
                balances: { native: null, tokens: [{ tick: 'ART', quantity: '1000', divisibility: 0 }] },
                error: null,
            }],
        };
        const pending = [{
            status: 'broadcast', chain: 'bitcoin', network: 'regtest', txid: 'ab'.repeat(32), ...meta,
        }];
        const netted = applyPendingBalanceDeltas(byChain, pending, defaultRegistry());
        expect(netted['bitcoin-regtest'][0].balances.tokens[0].quantity).toBe('600');
    });

    it('records no pending transaction when tracking is off', async () => {
        await destroyToken(base({ trackPendingTx: false }));
        expect(submitAction.mock.calls[0][0].pendingTxMeta).toBeUndefined();
    });
});
