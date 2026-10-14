// Copyright (c) 2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { submitAction } = vi.hoisted(() => ({ submitAction: vi.fn() }));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({ submitAction }));

import { createList } from '../../../packages/core/src/flows/createList.js';
import { stakeAction } from '../../../packages/core/src/flows/stakeAction.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const PUBKEY = 'ab'.repeat(32);
const FROM = {
    address: 'bcrt1qowner',
    publicKey: `02${'11'.repeat(32)}`,
    derivationPath: "m/84'/1'/0'/0/1",
};

function listOpts(params, extra = {}) {
    return {
        vault: {},
        walletId: 'wallet-1',
        password: 'secret',
        chainRegistry: {},
        sdkRegistry: {},
        chainId: 'bitcoin-regtest',
        from: FROM,
        params,
        ...extra,
    };
}

function stakeOpts(params, extra = {}) {
    return listOpts(params, { chainRegistry: defaultRegistry(), ...extra });
}

beforeEach(() => {
    submitAction.mockReset();
    submitAction.mockResolvedValue({ txid: 'protocol-tx' });
});

describe('STAKE validation boundaries', () => {
    it.each([
        [{ VERSION: '1', AMOUNT: '', SIGNING_PUBKEY: PUBKEY }, 'params.AMOUNT is required'],
        [{ VERSION: '1', AMOUNT: 'one', SIGNING_PUBKEY: PUBKEY }, 'positive decimal with at most 8 fractional digits'],
        [{ VERSION: '1', AMOUNT: '-1', SIGNING_PUBKEY: PUBKEY }, 'positive decimal with at most 8 fractional digits'],
        [{ VERSION: '1', AMOUNT: '1.', SIGNING_PUBKEY: PUBKEY }, 'positive decimal with at most 8 fractional digits'],
        [{ VERSION: '1', AMOUNT: '1' }, 'params.SIGNING_PUBKEY is required'],
    ])('rejects malformed params %# before submission', async (params, message) => {
        await expect(stakeAction(stakeOpts(params))).rejects.toThrow(message);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('accepts the smallest eight-decimal amount and uppercase hex pubkey', async () => {
        const params = {
            VERSION: '1',
            AMOUNT: '0.00000001',
            SIGNING_PUBKEY: PUBKEY.toUpperCase(),
        };
        await stakeAction(stakeOpts(params));
        expect(submitAction.mock.calls[0][0]).toMatchObject({
            actionData: { action: 'STAKE', params },
            pendingTxMeta: { actionSummary: 'Stake 0.00000001 XCHAIN' },
        });
    });
});

describe('LIST validation edges', () => {
    it.each([
        [undefined, 'createList: opts is required'],
        [listOpts(null), 'createList: params is required'],
        [listOpts({ VERSION: 0, TYPE: '1', ITEM: ['UNIT'] }), 'params.VERSION must be'],
        [listOpts({ VERSION: '0', TYPE: '1' }), 'params.ITEM must be a non-empty array'],
        [listOpts({ VERSION: '1', EDIT: '1', LIST_ACTION_INDEX: '4', ITEM: [] }), 'params.ITEM must be a non-empty array'],
        [listOpts({ VERSION: '1', EDIT: '3', LIST_ACTION_INDEX: '4', ITEM: ['UNIT'] }), 'params.EDIT must be'],
        [listOpts({ VERSION: '1', EDIT: '1', ITEM: ['UNIT'] }), 'params.LIST_ACTION_INDEX is required for v1'],
        [listOpts({ VERSION: '4', TYPE: '1', ITEM: ['UNIT'], NAME: 4 }), 'params.NAME must be a string for v4'],
        [listOpts({ VERSION: '4', TYPE: '1', ITEM: ['UNIT'], DESCRIPTION: false }), 'params.DESCRIPTION must be a string for v4'],
        [listOpts({ VERSION: '5', LIST_ACTION_INDEX: '4', NAME: 4 }), 'params.NAME must be a string for v5'],
        [listOpts({ VERSION: '5', LIST_ACTION_INDEX: '4', DESCRIPTION: [] }), 'params.DESCRIPTION must be a string for v5'],
    ])('rejects an uncovered LIST shape %#', async (input, message) => {
        await expect(createList(input)).rejects.toThrow(message);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('describes the single-item remove boundary and suppresses tracking', async () => {
        const params = {
            VERSION: '1',
            EDIT: '2',
            LIST_ACTION_INDEX: '4',
            ITEM: ['UNIT'],
        };
        await createList(listOpts(params, { trackPendingTx: false }));
        const call = submitAction.mock.calls[0][0];
        expect(call.actionData).toEqual({ action: 'LIST', params });
        expect(call.pendingTxMeta).toBeUndefined();
    });
});
