// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The list forms' protocol fee from the chain's fee schedule, and the Share
// page's "Share fee" row: XCHAIN plus fiat, XCHAIN alone with no price.

import { describe, expect, it } from 'vitest';
import {
    baseItemFeeFromSchedule,
    feeForGas,
    scheduleGas,
} from '../../../packages/core/src/flows/scheduleFee.js';
import {
    listSharedEditFeeFromSchedule,
    listShareFeeFromSchedule,
    shareFeeRowText,
} from '../../../packages/core/src/flows/listFeeSchedule.js';

// The indexer's bundled values (xchain-indexer src/coins/BTC.js).
const schedule = {
    gasPrice: '0.00001',
    gasSchedule: {
        LIST_SHARE: 100000,
        LIST_SHARED_EDIT_BASE: 5000,
        LIST_SHARED_EDIT_PER_ITEM: 100,
        XBRIDGE_BASE: 5000,
    },
    prices: { available: true, xchainUsd: '0.25', coinUsd: '98000' },
};

describe('scheduleFee', () => {
    it('reads a gas entry only as a non-negative integer', () => {
        expect(scheduleGas(schedule, 'LIST_SHARE')).toBe(100000n);
        expect(scheduleGas(schedule, 'MISSING')).toBeNull();
        expect(scheduleGas({ gasSchedule: { X: '1.5' } }, 'X')).toBeNull();
        expect(scheduleGas({ gasSchedule: { X: -1 } }, 'X')).toBeNull();
        expect(scheduleGas(null, 'X')).toBeNull();
    });

    it('prices gas at GAS_PRICE, truncated to 8 places, with the native figure when priced', () => {
        expect(feeForGas(schedule, 100000n)).toEqual({
            xchainFee: '1.00000000', requiredFeeSats: 255, scheduleEstimate: true,
        });
        expect(feeForGas({ ...schedule, gasPrice: '0.000000001' }, 1n).xchainFee).toBe('0.00000000');
        expect(feeForGas({ gasSchedule: {} }, 1n)).toBeNull();
    });

    it('sums a base-plus-per-item fee over each transaction', () => {
        expect(baseItemFeeFromSchedule(schedule, { baseKey: 'XBRIDGE_BASE' }).xchainFee).toBe('0.05000000');
        expect(baseItemFeeFromSchedule(schedule, {
            baseKey: 'LIST_SHARED_EDIT_BASE', perItemKey: 'LIST_SHARED_EDIT_PER_ITEM', items: [3, 2],
        }).xchainFee).toBe('0.10500000');
        expect(baseItemFeeFromSchedule(schedule, { baseKey: 'LIST_SHARE', items: [-1] })).toBeNull();
    });
});

describe('list fees from the schedule', () => {
    it('prices a share at the flat LIST_SHARE fee', () => {
        expect(listShareFeeFromSchedule(schedule)).toEqual({
            xchainFee: '1.00000000', requiredFeeSats: 255, scheduleEstimate: true,
        });
    });

    it('leaves the native figure out when the oracle prices are unavailable', () => {
        expect(listShareFeeFromSchedule({ ...schedule, prices: { available: false } })).toEqual({
            xchainFee: '1.00000000', scheduleEstimate: true,
        });
    });

    it('prices a shared-list edit at the base plus the per-item gas per transaction', () => {
        // One add of 4 members: 5,000 + 4 x 100 gas.
        expect(listSharedEditFeeFromSchedule(schedule, [4]).xchainFee).toBe('0.05400000');
        // A memo-only or name-and-description change: the base alone.
        expect(listSharedEditFeeFromSchedule(schedule, [0]).xchainFee).toBe('0.05000000');
        // Add then remove: two transactions, each with its own base.
        expect(listSharedEditFeeFromSchedule(schedule, [2, 1]).xchainFee).toBe('0.10300000');
    });

    it('fails closed when the schedule cannot price a list fee', () => {
        expect(listShareFeeFromSchedule(null)).toBeNull();
        expect(listShareFeeFromSchedule({ gasPrice: '0.00001', gasSchedule: {} })).toBeNull();
        expect(listSharedEditFeeFromSchedule({ gasPrice: '0.00001', gasSchedule: { LIST_SHARED_EDIT_BASE: 5000 } }, [1]))
            .toBeNull();
    });
});

describe('shareFeeRowText', () => {
    const quote = listShareFeeFromSchedule(schedule);

    it('reads the fee in XCHAIN with its fiat value beside it', () => {
        expect(shareFeeRowText({ quote, formatFiat: () => '~$0.25' })).toBe('1 XCHAIN ~$0.25');
    });

    it('reads XCHAIN alone when there is no price, never a made-up fiat figure', () => {
        expect(shareFeeRowText({ quote, formatFiat: () => null })).toBe('1 XCHAIN');
        expect(shareFeeRowText({ quote })).toBe('1 XCHAIN');
    });

    it('groups thousands and keeps every significant place', () => {
        expect(shareFeeRowText({ quote: { xchainFee: '12500.12345678' } })).toBe('12,500.12345678 XCHAIN');
    });

    it('says Calculating while the schedule loads and Priced at review only when nothing can price it', () => {
        expect(shareFeeRowText({ quote: null, pending: true })).toBe('Calculating');
        expect(shareFeeRowText({ quote: null, pending: false })).toBe('Priced at review');
    });
});
