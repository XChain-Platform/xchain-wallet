// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// P8 BET write composers. The property that matters most here is that
// each composer is nailed to ONE sdk.betting builder: a resolve and a place-bet
// differ on the wire only by AMOUNT, so a composer reaching the wrong builder
// would turn an intended stake into a payout decision (or the reverse).

import { describe, it, expect, vi } from 'vitest';

// The builder-selection tests below never reach submitAction (they stop at the
// missing signing source), so stubbing it here only affects the block,
// which is the one that needs to read the encoderOpts the flow builds.
const { submitCalls } = vi.hoisted(() => ({ submitCalls: [] }));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: async (opts) => { submitCalls.push(opts); return { txid: 'tx' }; },
}));

import {
    createMarketAction,
    placeBetAction,
    resolveMarketAction,
    cancelMarketAction,
} from '../../../packages/core/src/flows/betActions.js';

function harness() {
    const calls = [];
    const betting = {
        createMarketParams: vi.fn((i) => { calls.push('createMarketParams'); return { version: 0, ...i }; }),
        placeBetParams: vi.fn((i) => { calls.push('placeBetParams'); return { version: 2, ...i }; }),
        resolveMarketParams: vi.fn((i) => { calls.push('resolveMarketParams'); return { version: 3, ...i }; }),
        cancelMarketParams: vi.fn((i) => { calls.push('cancelMarketParams'); return { version: 1, ...i }; }),
    };
    return {
        calls,
        betting,
        sdkRegistry: { get: vi.fn(() => ({ betting })) },
    };
}

// Each composer is driven far enough to reach its builder, then allowed to fail
// on the missing signing source. That proves the builder selection without
// standing up a vault, and mirrors how coinpayAction's guards are tested.
const FROM_MISSING = /from|source/i;

describe('flows/betActions builder selection', () => {
    it('createMarketAction uses createMarketParams and nothing else', async () => {
        const h = harness();
        await expect(createMarketAction({
            sdkRegistry: h.sdkRegistry, chainId: 'c', params: { label: 'L', tick: 'T', outcomes: 'A,B', deadline: '1' },
        })).rejects.toThrow(FROM_MISSING);
        expect(h.calls).toEqual(['createMarketParams']);
    });

    it('placeBetAction uses placeBetParams and nothing else', async () => {
        const h = harness();
        await expect(placeBetAction({
            sdkRegistry: h.sdkRegistry, chainId: 'c', params: { feedActionIndex: '5', outcome: 0, amount: '1' },
        })).rejects.toThrow(FROM_MISSING);
        expect(h.calls).toEqual(['placeBetParams']);
    });

    it('resolveMarketAction uses resolveMarketParams, never placeBetParams', async () => {
        const h = harness();
        await expect(resolveMarketAction({
            sdkRegistry: h.sdkRegistry, chainId: 'c', params: { feedActionIndex: '5', outcome: 0 },
        })).rejects.toThrow(FROM_MISSING);
        expect(h.calls).toEqual(['resolveMarketParams']);
        expect(h.betting.placeBetParams).not.toHaveBeenCalled();
    });

    it('cancelMarketAction uses cancelMarketParams and nothing else', async () => {
        const h = harness();
        await expect(cancelMarketAction({
            sdkRegistry: h.sdkRegistry, chainId: 'c', params: { feedActionIndex: '5' },
        })).rejects.toThrow(FROM_MISSING);
        expect(h.calls).toEqual(['cancelMarketParams']);
    });
});

describe('flows/betActions up-front guards', () => {
    it('each requires the field its format cannot be built without', async () => {
        const h = harness();
        const base = { sdkRegistry: h.sdkRegistry, chainId: 'c' };
        await expect(createMarketAction({ ...base, params: { tick: 'T' } })).rejects.toThrow(/label is required/);
        await expect(createMarketAction({ ...base, params: { label: 'L' } })).rejects.toThrow(/tick is required/);
        await expect(placeBetAction({ ...base, params: {} })).rejects.toThrow(/feedActionIndex is required/);
        await expect(resolveMarketAction({ ...base, params: {} })).rejects.toThrow(/feedActionIndex is required/);
        await expect(cancelMarketAction({ ...base, params: {} })).rejects.toThrow(/feedActionIndex is required/);
    });

    it('a feedActionIndex of 0 is accepted, not treated as missing', async () => {
        // Action index 0 is falsy but legitimate; a truthiness guard here would
        // make the very first market on a chain unbettable.
        const h = harness();
        await expect(placeBetAction({
            sdkRegistry: h.sdkRegistry, chainId: 'c', params: { feedActionIndex: 0, outcome: 0, amount: '1' },
        })).rejects.toThrow(FROM_MISSING);
        expect(h.calls).toEqual(['placeBetParams']);
    });

    it('reports required plumbing before touching the SDK', async () => {
        await expect(placeBetAction({ chainId: 'c', params: { feedActionIndex: '1' } }))
            .rejects.toThrow(/sdkRegistry is required/);
        await expect(placeBetAction({ sdkRegistry: { get: () => ({}) }, params: { feedActionIndex: '1' } }))
            .rejects.toThrow(/chainId is required/);
    });

    it('names the missing helper when the SDK predates the BET surface', async () => {
        const sdkRegistry = { get: () => ({ betting: {} }) };
        await expect(placeBetAction({ sdkRegistry, chainId: 'c', params: { feedActionIndex: '1' } }))
            .rejects.toThrow(/sdk\.betting\.placeBetParams is unavailable/);
    });
});

// The native-coin protocol fee. BET charges on create (v0) and place
// (v2), and on LTC/DOGE a native-coin output is the ONLY way to pay a protocol
// fee, so a flow that dropped this flag composed a guaranteed-invalid action
// that still cost a miner fee.
describe('flows/betActions native-coin fee mode', () => {
    const FROM = { address: 'ltc1qexample', publicKey: '02aabbcc', derivationPath: "m/84'/2'/0'/0/0" };
    const base = (h) => ({
        sdkRegistry: h.sdkRegistry,
        chainRegistry: {},
        chainId: 'litecoin-regtest',
        from: FROM,
        password: 'pw',
        trackPendingTx: false,
    });

    it('forwards the flag into encoderOpts for both fee-bearing formats', async () => {
        submitCalls.length = 0;
        const h = harness();
        await createMarketAction({
            ...base(h),
            params: { label: 'L', tick: 'T', outcomes: ['A', 'B'], deadline: 1 },
            payFeeInNativeCoin: true,
        });
        await placeBetAction({
            ...base(h),
            params: { feedActionIndex: '5', outcome: 0, amount: '1' },
            payFeeInNativeCoin: true,
        });
        expect(submitCalls).toHaveLength(2);
        for (const call of submitCalls) {
            expect(call.encoderOpts.payFeeInNativeCoin).toBe(true);
            // The flag is the flow's own, never a wire field: it must not reach
            // the BET params the SDK builder produced.
            expect(call.actionData.params.payFeeInNativeCoin).toBeUndefined();
        }
    });

    it('omits the key entirely when the caller leaves the fee in XCHAIN', async () => {
        submitCalls.length = 0;
        const h = harness();
        await placeBetAction({ ...base(h), params: { feedActionIndex: '5', outcome: 0, amount: '1' } });
        // Absent rather than false: the encoder contract treats the key's
        // presence as the request, and a literal false is a payload change.
        expect('payFeeInNativeCoin' in submitCalls[0].encoderOpts).toBe(false);
    });
});
