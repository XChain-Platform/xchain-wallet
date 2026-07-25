// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-03 callback flows: the CALLBACK v0 wire params, the holder
// distribution summary that gates the ISSUE v4 config editor and drives
// the execution payout preview, and the exact decimal math the payout
// relies on (mirrors the indexer's bcmulfloor per holder).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'cb-txid-1' })),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => ({
        address: from.address,
        publicKey: from.publicKey,
        derivationPath: from.derivationPath || null,
        addressId: from.addressId || null,
    })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { callbackAction } from '../../../packages/core/src/flows/callbackAction.js';
import {
    tokenHolderSummary,
    mulFloorDecimal,
    addDecimal,
} from '../../../packages/core/src/flows/tokenHolders.js';

const FROM = { address: 'ownerAddr', publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", addressId: 'a1' };

function callbackOpts(extra = {}) {
    return {
        vault: {}, walletId: 'w1', password: 'pw',
        chainRegistry: {}, sdkRegistry: {}, chainId: 'bitcoin-regtest',
        from: FROM, params: { VERSION: '0', TICK: 'JDOG' },
        ...extra,
    };
}

beforeEach(() => {
    vi.mocked(submitAction).mockClear();
    vi.mocked(submitAction).mockResolvedValue({ txid: 'cb-txid-1' });
});

describe('callbackAction', () => {
    it('composes a CALLBACK v0 action and forwards prebuiltPsbt', async () => {
        const prebuilt = { psbtHex: 'de', encoding: 'op_return', actionString: 'CALLBACK|0|JDOG', version: 0 };
        const res = await callbackAction(callbackOpts({ params: { VERSION: '0', TICK: 'JDOG', MEMO: 'bye' }, prebuiltPsbt: prebuilt }));
        expect(res.txid).toBe('cb-txid-1');
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.actionData).toEqual({ action: 'CALLBACK', params: { VERSION: '0', TICK: 'JDOG', MEMO: 'bye' } });
        expect(call.prebuiltPsbt).toBe(prebuilt);
        expect(call.encoderOpts.pubkey).toBe('02ab');
    });

    it('requires a TICK', async () => {
        await expect(callbackAction(callbackOpts({ params: { VERSION: '0' } }))).rejects.toThrow(/TICK/);
        expect(submitAction).not.toHaveBeenCalled();
    });
});

describe('mulFloorDecimal (mirrors indexer bcmulfloor)', () => {
    it('multiplies and floors to the given decimals', () => {
        expect(mulFloorDecimal('100', '0.5', 8)).toBe('50');
        expect(mulFloorDecimal('3', '0.333', 2)).toBe('0.99');
        // floor: 7 * 0.14 = 0.98 -> at 0 decimals floors to 0
        expect(mulFloorDecimal('7', '0.14', 0)).toBe('0');
        expect(mulFloorDecimal('7', '0.14', 2)).toBe('0.98');
    });

    it('is BigInt-exact past 2^53', () => {
        // 10_000_000_000_000_000 * 2 = 2e16, well past Number precision
        expect(mulFloorDecimal('10000000000000000', '2', 0)).toBe('20000000000000000');
    });

    it('returns 0 for malformed input', () => {
        expect(mulFloorDecimal('abc', '2', 0)).toBe('0');
        expect(mulFloorDecimal('2', '', 0)).toBe('0');
    });
});

describe('addDecimal', () => {
    it('adds exactly at the target precision', () => {
        expect(addDecimal('0.98', '0.01', 2)).toBe('0.99');
        expect(addDecimal('100', '0.5', 8)).toBe('100.5');
        expect(addDecimal('0', '0', 0)).toBe('0');
    });
});

function makeSdk(holders, total) {
    return {
        get: () => ({
            getHolders: vi.fn(async () => (total != null ? { data: holders, total } : holders)),
        }),
    };
}

describe('tokenHolderSummary', () => {
    const OWNER = 'ownerAddr';

    it('reports not-distributed when only the owner holds', async () => {
        const s = await tokenHolderSummary({
            sdkRegistry: makeSdk([{ address: OWNER, amount: '1000' }]),
            chainId: 'c', tick: 'JDOG', owner: OWNER,
        });
        expect(s.isDistributed).toBe(false);
        expect(s.ownerHolds).toBe(true);
        expect(s.recipientCount).toBe(0);
    });

    it('reports distributed with one non-owner holder', async () => {
        const s = await tokenHolderSummary({
            sdkRegistry: makeSdk([{ address: OWNER, amount: '900' }, { address: 'bob', amount: '100' }]),
            chainId: 'c', tick: 'JDOG', owner: OWNER,
        });
        expect(s.isDistributed).toBe(true);
        expect(s.recipientCount).toBe(1);
    });

    it('reports distributed even when the single holder is not the owner', async () => {
        const s = await tokenHolderSummary({
            sdkRegistry: makeSdk([{ address: 'bob', amount: '100' }]),
            chainId: 'c', tick: 'JDOG', owner: OWNER,
        });
        expect(s.isDistributed).toBe(true);
    });

    it('computes the total callback payout over non-owner holders', async () => {
        // bob 100 + carol 50, at 0.5 payout per unit, 8 decimals -> 75
        const s = await tokenHolderSummary({
            sdkRegistry: makeSdk([
                { address: OWNER, amount: '1000' },
                { address: 'bob', amount: '100' },
                { address: 'carol', amount: '50' },
            ]),
            chainId: 'c', tick: 'JDOG', owner: OWNER,
            callbackAmount: '0.5', callbackDecimals: 8,
        });
        expect(s.recipientCount).toBe(2);
        expect(s.totalPayout).toBe('75');
    });

    it('excludes zero and negative balances', async () => {
        const s = await tokenHolderSummary({
            sdkRegistry: makeSdk([
                { address: OWNER, amount: '1000' },
                { address: 'bob', amount: '0' },
                { address: 'carol', amount: '10' },
            ]),
            chainId: 'c', tick: 'JDOG', owner: OWNER,
        });
        expect(s.recipientCount).toBe(1);
    });

    it('uses the explorer total for holderCount and flags partial when capped', async () => {
        const rows = Array.from({ length: 500 }, (_, i) => ({ address: `a${i}`, amount: '1' }));
        const s = await tokenHolderSummary({
            sdkRegistry: makeSdk(rows, 1200), chainId: 'c', tick: 'JDOG', owner: OWNER, limit: 500,
        });
        expect(s.holderCount).toBe(1200);
        expect(s.partial).toBe(true);
    });

    it('null payout when no callbackAmount given', async () => {
        const s = await tokenHolderSummary({
            sdkRegistry: makeSdk([{ address: 'bob', amount: '5' }]),
            chainId: 'c', tick: 'JDOG', owner: OWNER,
        });
        expect(s.totalPayout).toBeNull();
    });
});
