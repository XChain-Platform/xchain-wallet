// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-29 activation gate. The load-bearing property is the PRE-train
// state: with the shipped map all-null, nothing may emit or honor
// GATE_MIN_AMOUNT anywhere, at any height, with zero network calls.

import { describe, it, expect, vi } from 'vitest';

import {
    GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS,
    gateMinAmountScheduledHeight,
    isGateMinAmountActive,
    resolveGateMinAmountActive,
    VOTE_BINDING_MINIMUMS_TIMES,
    VOTE_CALLBACK_TIMELOCK_TIMES,
    isVoteBindingMinimumsActive,
    isVoteCallbackTimelockActive,
} from '../../../packages/core/src/flows/protocolActivations.js';

describe('shipped GATE_MIN_AMOUNT map (testnet genesis-active, mainnet unscheduled)', () => {
    const TESTNET = ['bitcoin-testnet', 'litecoin-testnet', 'dogecoin-testnet'];

    it('covers all nine chains', () => {
        expect(Object.keys(GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS)).toHaveLength(9);
    });

    it('activates the three testnets from block 0', () => {
        for (const id of TESTNET) {
            expect(GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS[id]).toBe(0);
            expect(gateMinAmountScheduledHeight(id)).toBe(0);
            expect(isGateMinAmountActive({ chainId: id, blockHeight: 0 })).toBe(true);
        }
    });

    it('leaves every mainnet and regtest chain unscheduled', () => {
        const ids = Object.keys(GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS).filter((id) => !TESTNET.includes(id));
        expect(ids).toHaveLength(6);
        for (const id of ids) {
            expect(GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS[id]).toBeNull();
            expect(gateMinAmountScheduledHeight(id)).toBeNull();
            expect(isGateMinAmountActive({ chainId: id, blockHeight: Number.MAX_SAFE_INTEGER })).toBe(false);
        }
    });

    it('is frozen (a height cannot be poked in at runtime)', () => {
        expect(Object.isFrozen(GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS)).toBe(true);
        expect(() => { GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS['bitcoin-mainnet'] = 1; }).toThrow();
    });

    it('treats unknown chains as unscheduled', () => {
        expect(gateMinAmountScheduledHeight('not-a-chain')).toBeNull();
        expect(isGateMinAmountActive({ chainId: 'not-a-chain', blockHeight: 1 })).toBe(false);
    });

    it('resolveGateMinAmountActive never fetches a height while unscheduled', async () => {
        const getBlockHeight = vi.fn(async () => { throw new Error('must not be called'); });
        await expect(resolveGateMinAmountActive({ chainId: 'bitcoin-mainnet', getBlockHeight }))
            .resolves.toBe(false);
        expect(getBlockHeight).not.toHaveBeenCalled();
    });
});

describe('scheduled behavior (test override map)', () => {
    const HEIGHTS = { 'bitcoin-regtest': 100 };

    it('activation is inclusive at the pinned height', () => {
        const at = (blockHeight) => isGateMinAmountActive({ chainId: 'bitcoin-regtest', blockHeight, heights: HEIGHTS });
        expect(at(99)).toBe(false);
        expect(at(100)).toBe(true);
        expect(at(101)).toBe(true);
    });

    it('a null/garbage height reads as not active', () => {
        const at = (blockHeight) => isGateMinAmountActive({ chainId: 'bitcoin-regtest', blockHeight, heights: HEIGHTS });
        expect(at(null)).toBe(false);
        expect(at(undefined)).toBe(false);
        expect(at(NaN)).toBe(false);
    });

    it('resolveGateMinAmountActive fetches once and compares', async () => {
        const getBlockHeight = vi.fn(async () => 100);
        await expect(resolveGateMinAmountActive({ chainId: 'bitcoin-regtest', getBlockHeight, heights: HEIGHTS }))
            .resolves.toBe(true);
        expect(getBlockHeight).toHaveBeenCalledTimes(1);
    });

    it('resolve fails closed on a fetch error or null watermark', async () => {
        await expect(resolveGateMinAmountActive({
            chainId: 'bitcoin-regtest', heights: HEIGHTS,
            getBlockHeight: async () => { throw new Error('explorer down'); },
        })).resolves.toBe(false);
        await expect(resolveGateMinAmountActive({
            chainId: 'bitcoin-regtest', heights: HEIGHTS,
            getBlockHeight: async () => null,
        })).resolves.toBe(false);
    });
});

// PC-42: the two VOTE flag-days. Unlike GATE_MIN_AMOUNT these carry REAL
// scheduled values and are BLOCK TIMESTAMPS, not heights.
describe('VOTE binding-poll flag-days (PC-42)', () => {
    const MAINNET_FLAG_DAY = 1786060800; // 2026-08-07, per xchain-indexer protocol_changes.js

    it('matches the indexer schedule: mainnet 2026-08-07, testnet and regtest from genesis', () => {
        expect(VOTE_CALLBACK_TIMELOCK_TIMES['bitcoin-mainnet']).toBe(MAINNET_FLAG_DAY);
        expect(VOTE_CALLBACK_TIMELOCK_TIMES['litecoin-mainnet']).toBe(MAINNET_FLAG_DAY);
        expect(VOTE_CALLBACK_TIMELOCK_TIMES['dogecoin-mainnet']).toBe(MAINNET_FLAG_DAY);
        expect(VOTE_CALLBACK_TIMELOCK_TIMES['bitcoin-regtest']).toBe(0);
        expect(VOTE_CALLBACK_TIMELOCK_TIMES['bitcoin-testnet']).toBe(0);
        // The two changes activate together today.
        expect(VOTE_BINDING_MINIMUMS_TIMES).toEqual(VOTE_CALLBACK_TIMELOCK_TIMES);
    });

    it('is live on regtest and testnet at any block time', () => {
        expect(isVoteCallbackTimelockActive({ chainId: 'bitcoin-regtest', blockTime: 1 })).toBe(true);
        expect(isVoteBindingMinimumsActive({ chainId: 'bitcoin-testnet', blockTime: 1 })).toBe(true);
    });

    it('gates mainnet on the flag day, inclusive', () => {
        expect(isVoteCallbackTimelockActive({ chainId: 'bitcoin-mainnet', blockTime: MAINNET_FLAG_DAY - 1 })).toBe(false);
        expect(isVoteCallbackTimelockActive({ chainId: 'bitcoin-mainnet', blockTime: MAINNET_FLAG_DAY })).toBe(true);
        expect(isVoteCallbackTimelockActive({ chainId: 'bitcoin-mainnet', blockTime: MAINNET_FLAG_DAY + 1 })).toBe(true);
    });

    it('fails closed on an unusable block time or an unknown chain', () => {
        // A status outage must withhold the field, never emit one the chain drops.
        for (const blockTime of [null, undefined, NaN, 'soon']) {
            expect(isVoteCallbackTimelockActive({ chainId: 'bitcoin-regtest', blockTime })).toBe(false);
        }
        expect(isVoteCallbackTimelockActive({ chainId: 'ethereum-mainnet', blockTime: 9e9 })).toBe(false);
    });
});
