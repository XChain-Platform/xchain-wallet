// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';

import {
    actionByTxid,
    listsForSource,
} from '../../../packages/core/src/flows/listQueries.js';

const CHAIN_ID = 'bitcoin-regtest';

function registry(sdk) {
    return { get: vi.fn(() => sdk) };
}

describe('actionByTxid', () => {
    it('queries the transaction by tx_hash and returns the indexed action', async () => {
        const action = { action: 'SEND', tx_hash: 'abc' };
        const getTransaction = vi.fn(async () => action);
        const sdkRegistry = registry({ getTransaction });

        await expect(actionByTxid({ sdkRegistry, chainId: CHAIN_ID, txid: 'abc' }))
            .resolves.toBe(action);
        expect(sdkRegistry.get).toHaveBeenCalledWith(CHAIN_ID);
        expect(getTransaction).toHaveBeenCalledWith('abc', 'tx_hash');
    });

    it.each([
        Object.assign(new Error('pending'), { status: 404 }),
        Object.assign(new Error('pending'), { response: { status: 404 } }),
        new Error('HTTP 404: not found'),
    ])('maps explorer not-found errors to a pending null result', async (error) => {
        const sdkRegistry = registry({ getTransaction: vi.fn(async () => { throw error; }) });
        await expect(actionByTxid({ sdkRegistry, chainId: CHAIN_ID, txid: 'abc' }))
            .resolves.toBeNull();
    });

    it('propagates non-404 explorer failures', async () => {
        const error = Object.assign(new Error('unavailable'), { status: 503 });
        const sdkRegistry = registry({ getTransaction: vi.fn(async () => { throw error; }) });
        await expect(actionByTxid({ sdkRegistry, chainId: CHAIN_ID, txid: 'abc' }))
            .rejects.toBe(error);
    });

    it.each([
        [{}, 'sdkRegistry is required'],
        [{ sdkRegistry: {} }, 'chainId is required'],
        [{ sdkRegistry: {}, chainId: CHAIN_ID }, 'txid is required'],
    ])('validates required arguments', async (args, message) => {
        await expect(actionByTxid(args)).rejects.toThrow(message);
    });
});

describe('listsForSource', () => {
    it('queries address-authored lists', async () => {
        const rows = [{ action_index: '7' }];
        const getLists = vi.fn(async () => rows);
        const sdkRegistry = registry({ getLists });

        await expect(listsForSource({ sdkRegistry, chainId: CHAIN_ID, address: 'mSource' }))
            .resolves.toBe(rows);
        expect(getLists).toHaveBeenCalledWith('mSource', 'address');
    });

    it.each([
        [{}, 'sdkRegistry is required'],
        [{ sdkRegistry: {} }, 'chainId is required'],
        [{ sdkRegistry: {}, chainId: CHAIN_ID }, 'address is required'],
    ])('validates required arguments', async (args, message) => {
        await expect(listsForSource(args)).rejects.toThrow(message);
    });
});
