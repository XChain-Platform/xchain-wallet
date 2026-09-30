// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import sdkFormats from 'xchain-sdk/src/protocol/formats.js';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'list-tx-1' })),
}));

import { createList } from '../../../packages/core/src/flows/createList.js';
import { listFormatSupport } from '../../../packages/core/src/flows/listFormatSupport.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';

const FROM = {
    address: 'bcrt1qlistowner',
    publicKey: '02d29101b24f1a3d7aa030c799a94c805d6828b1176523a5c1fb7ebae7b5c12e4b',
    derivationPath: "m/84'/1'/0'/0/0",
};

function opts(params) {
    return {
        vault: {},
        walletId: 'w1',
        password: 'pw',
        chainRegistry: {},
        sdkRegistry: {},
        chainId: 'bitcoin-regtest',
        from: FROM,
        params,
    };
}

function submitted() {
    return vi.mocked(submitAction).mock.calls[0][0];
}

describe('createList share, transfer, and union shapes', () => {
    beforeEach(() => {
        vi.mocked(submitAction).mockClear();
    });

    it('accepts a v2 share without ITEM and describes the pending action', async () => {
        const params = { VERSION: '2', LIST_ACTION_INDEX: '42', MEMO: 'Publish it' };

        await expect(createList(opts(params))).resolves.toEqual({ txid: 'list-tx-1' });

        expect(submitted().actionData).toEqual({ action: 'LIST', params });
        expect(submitted().pendingTxMeta).toEqual({
            fromAddress: FROM.address,
            toAddress: null,
            actionSummary: 'Share list #42',
        });
    });

    it.each([
        [{ VERSION: '2' }, /LIST_ACTION_INDEX is required for v2/],
        [{ VERSION: '2', LIST_ACTION_INDEX: '42', ITEM: [] }, /ITEM is not valid for v2/],
        [{ VERSION: '2', LIST_ACTION_INDEX: '42', ITEM: ['1'] }, /ITEM is not valid for v2/],
    ])('refuses an invalid v2 share shape %#', async (params, error) => {
        await expect(createList(opts(params))).rejects.toThrow(error);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('accepts a v3 transfer without ITEM and describes the destination', async () => {
        const params = {
            VERSION: '3',
            LIST_ACTION_INDEX: '42',
            DESTINATION: 'bcrt1qnewowner',
        };

        await expect(createList(opts(params))).resolves.toEqual({ txid: 'list-tx-1' });

        expect(submitted().actionData).toEqual({ action: 'LIST', params });
        expect(submitted().pendingTxMeta).toEqual({
            fromAddress: FROM.address,
            toAddress: null,
            actionSummary: 'Transfer list #42 to bcrt1qnewowner',
        });
    });

    it.each([
        [{ VERSION: '3', DESTINATION: 'bcrt1qnewowner' }, /LIST_ACTION_INDEX is required for v3/],
        [{ VERSION: '3', LIST_ACTION_INDEX: '42' }, /DESTINATION is required for v3/],
        [{ VERSION: '3', LIST_ACTION_INDEX: '42', DESTINATION: '' }, /DESTINATION is required for v3/],
        [{ VERSION: '3', LIST_ACTION_INDEX: '42', DESTINATION: 'bcrt1qnewowner', ITEM: ['1'] }, /ITEM is not valid for v3/],
    ])('refuses an invalid v3 transfer shape %#', async (params, error) => {
        await expect(createList(opts(params))).rejects.toThrow(error);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('accepts a v0 type 3 union and describes its member count', async () => {
        const params = { VERSION: '0', TYPE: '3', ITEM: ['12', '34'] };

        await expect(createList(opts(params))).resolves.toEqual({ txid: 'list-tx-1' });

        expect(submitted().actionData).toEqual({ action: 'LIST', params });
        expect(submitted().pendingTxMeta).toEqual({
            fromAddress: FROM.address,
            toAddress: null,
            actionSummary: 'Create union of 2 lists',
        });
    });

    it('accepts the 16-member union boundary', async () => {
        const items = Array.from({ length: 16 }, (_, index) => String(index + 1));

        await createList(opts({ VERSION: '0', TYPE: '3', ITEM: items }));

        expect(submitted().pendingTxMeta.actionSummary).toBe('Create union of 16 lists');
    });

    it.each([
        [[], /ITEM must be a non-empty array/],
        [Array.from({ length: 17 }, (_, index) => String(index + 1)), /at most 16 action indexes/],
        [['0'], /positive-integer action indexes/],
        [['-1'], /positive-integer action indexes/],
        [['1.5'], /positive-integer action indexes/],
        [['^12'], /positive-integer action indexes/],
        [[12], /positive-integer action indexes/],
    ])('refuses an invalid union member set %#', async (items, error) => {
        await expect(createList(opts({ VERSION: '0', TYPE: '3', ITEM: items })))
            .rejects.toThrow(error);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it.each([
        [{ VERSION: '0', TYPE: '4', ITEM: ['value'] }, /params.TYPE must be/],
        [{ VERSION: '4', LIST_ACTION_INDEX: '42' }, /params.VERSION must be/],
    ])('keeps refusing unsupported LIST shapes %#', async (params, error) => {
        await expect(createList(opts(params))).rejects.toThrow(error);
        expect(submitAction).not.toHaveBeenCalled();
    });
});

describe('listFormatSupport', () => {
    it('enables all three features when LIST formats 2 and 3 are present', async () => {
        const getActionFormats = vi.fn(() => ({
            0: 'VERSION|TYPE|MEMO|...ITEM',
            1: 'VERSION|EDIT|LIST_ACTION_INDEX|MEMO|...ITEM',
            2: 'VERSION|LIST_ACTION_INDEX|MEMO',
            3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO',
        }));
        const sdkRegistry = { get: vi.fn(() => ({ getActionFormats })) };

        await expect(listFormatSupport({ sdkRegistry, chainId: 'bitcoin-regtest' }))
            .resolves.toEqual({ share: true, transfer: true, union: true });
        expect(sdkRegistry.get).toHaveBeenCalledWith('bitcoin-regtest');
        expect(getActionFormats).toHaveBeenCalledWith('LIST');
    });

    it('disables all three features for the pinned 0.20.0 LIST formats', async () => {
        const sdkRegistry = { get: () => ({ getActionFormats: () => sdkFormats.LIST }) };

        expect(sdkFormats.LIST).toEqual({
            0: 'VERSION|TYPE|MEMO|...ITEM',
            1: 'VERSION|EDIT|LIST_ACTION_INDEX|MEMO|...ITEM',
        });

        await expect(listFormatSupport({ sdkRegistry, chainId: 'bitcoin-regtest' }))
            .resolves.toEqual({ share: false, transfer: false, union: false });
    });

    it.each([
        [{ 2: 'VERSION|LIST_ACTION_INDEX|MEMO' }],
        [{ 3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO' }],
    ])('fails closed when only one new LIST format is present %#', async (formats) => {
        const sdkRegistry = { get: () => ({ getActionFormats: () => formats }) };

        await expect(listFormatSupport({ sdkRegistry, chainId: 'bitcoin-regtest' }))
            .resolves.toEqual({ share: false, transfer: false, union: false });
    });

    it('fails closed when SDK lookup throws', async () => {
        const sdkRegistry = { get: () => { throw new Error('registry unavailable'); } };

        await expect(listFormatSupport({ sdkRegistry, chainId: 'bitcoin-regtest' }))
            .resolves.toEqual({ share: false, transfer: false, union: false });
    });
});
