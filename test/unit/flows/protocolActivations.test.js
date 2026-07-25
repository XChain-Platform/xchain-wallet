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
} from '../../../packages/core/src/flows/protocolActivations.js';

describe('shipped GATE_MIN_AMOUNT map (pre--train state)', () => {
    it('covers all nine chains and schedules NONE of them', () => {
        const ids = Object.keys(GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS);
        expect(ids).toHaveLength(9);
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
