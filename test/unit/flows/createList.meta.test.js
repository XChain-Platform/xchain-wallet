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

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'list-tx-1' })),
}));

import { createList } from '../../../packages/core/src/flows/createList.js';
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

describe('createList metadata shapes', () => {
    beforeEach(() => {
        vi.mocked(submitAction).mockClear();
    });

    it('accepts a named v4 create and describes the name', async () => {
        const params = {
            VERSION: '4',
            TYPE: '2',
            NAME: 'Treasury wallets',
            DESCRIPTION: 'Quarterly review',
            ITEM: ['bcrt1qtreasury'],
        };

        await expect(createList(opts(params))).resolves.toEqual({ txid: 'list-tx-1' });

        expect(submitted().actionData).toEqual({ action: 'LIST', params });
        expect(submitted().pendingTxMeta.actionSummary)
            .toBe('Create address list "Treasury wallets" of 1 item');
    });

    it('accepts a v4 create with neither metadata field', async () => {
        const params = {
            VERSION: '4',
            TYPE: '1',
            NAME: '',
            DESCRIPTION: '',
            ITEM: ['JDOG', 'BRRR'],
        };

        await createList(opts(params));

        expect(submitted().actionData).toEqual({ action: 'LIST', params });
        expect(submitted().pendingTxMeta.actionSummary).toBe('Create token list of 2 items');
    });

    it('accepts a named v4 union under the v0 union rules', async () => {
        const params = {
            VERSION: '4',
            TYPE: '3',
            NAME: 'Sanctions',
            DESCRIPTION: '',
            ITEM: ['12', '34'],
        };

        await createList(opts(params));

        expect(submitted().actionData).toEqual({ action: 'LIST', params });
        expect(submitted().pendingTxMeta.actionSummary)
            .toBe('Create union list "Sanctions" of 2 items');
    });

    it('accepts a v5 metadata change and describes the target list', async () => {
        const params = {
            VERSION: '5',
            LIST_ACTION_INDEX: '42',
            NAME: 'Operations',
            DESCRIPTION: '',
        };

        await expect(createList(opts(params))).resolves.toEqual({ txid: 'list-tx-1' });

        expect(submitted().actionData).toEqual({ action: 'LIST', params });
        expect(submitted().pendingTxMeta.actionSummary).toBe('Rename list #42');
    });

    it('refuses a v5 metadata change with both fields empty', async () => {
        await expect(createList(opts({
            VERSION: '5',
            LIST_ACTION_INDEX: '42',
            NAME: '',
            DESCRIPTION: '',
        }))).rejects.toThrow(/no change/);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('refuses ITEM on v5', async () => {
        await expect(createList(opts({
            VERSION: '5',
            LIST_ACTION_INDEX: '42',
            NAME: 'Operations',
            ITEM: ['JDOG'],
        }))).rejects.toThrow(/ITEM is not valid for v5/);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('refuses v5 without a list action index', async () => {
        await expect(createList(opts({
            VERSION: '5',
            NAME: 'Operations',
        }))).rejects.toThrow(/LIST_ACTION_INDEX is required for v5/);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it.each([
        [{ VERSION: '0', TYPE: '2', ITEM: ['address'] }, 'Create address list of 1 item'],
        [{ VERSION: '1', EDIT: '1', LIST_ACTION_INDEX: '42', ITEM: ['JDOG'] }, 'Add 1 item to list #42'],
        [{ VERSION: '2', LIST_ACTION_INDEX: '42' }, 'Share list #42'],
        [{ VERSION: '3', LIST_ACTION_INDEX: '42', DESTINATION: 'bcrt1qnewowner' }, 'Transfer list #42 to bcrt1qnewowner'],
    ])('keeps the v0 to v3 summary for VERSION $params.VERSION', async (params, summary) => {
        await createList(opts(params));

        expect(submitted().pendingTxMeta.actionSummary).toBe(summary);
    });
});
