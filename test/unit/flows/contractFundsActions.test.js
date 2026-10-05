// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// depositAction and withdrawAction share one composer; these tests pin the
// validation errors, the action name, the pending summary and the encoder
// options handed to submitAction.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { submitAction } = vi.hoisted(() => ({ submitAction: vi.fn() }));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({ submitAction }));

import {
    depositAction,
    withdrawAction,
} from '../../../packages/core/src/flows/contractFundsActions.js';

const PARAMS = { VERSION: '1', CONTRACT_ACTION_INDEX: '7', TICK: 'GAS', QUANTITY: '25' };

function baseOpts(extra = {}) {
    return {
        vault: {},
        walletId: 'w1',
        password: 'pw',
        chainId: 'c1',
        from: { address: 'addr1', publicKey: 'pub1', derivationPath: "m/84'/0'/0'/0/0" },
        params: { ...PARAMS },
        ...extra,
    };
}

const FLOWS = [
    ['depositAction', depositAction, 'DEPOSIT'],
    ['withdrawAction', withdrawAction, 'WITHDRAW'],
];

beforeEach(() => {
    submitAction.mockReset();
    submitAction.mockResolvedValue({ txid: 'tx' });
});

describe.each(FLOWS)('%s validation', (name, flow) => {
    it('throws naming the flow when opts is missing', () => {
        expect(() => flow()).toThrow(`${name}: opts is required`);
    });

    it('throws naming the flow when params is missing', () => {
        expect(() => flow(baseOpts({ params: undefined }))).toThrow(`${name}: params is required`);
    });

    it.each(['CONTRACT_ACTION_INDEX', 'TICK', 'QUANTITY'])('throws when %s is missing', (field) => {
        const params = { ...PARAMS };
        delete params[field];
        expect(() => flow(baseOpts({ params }))).toThrow(`${name}: params.${field} is required`);
        expect(submitAction).not.toHaveBeenCalled();
    });
});

describe.each(FLOWS)('%s submission', (name, flow, action) => {
    it('submits the action with params unchanged', async () => {
        const opts = baseOpts();
        await flow(opts);
        const call = submitAction.mock.calls[0][0];
        expect(call.actionData.action).toBe(action);
        expect(call.actionData.params).toBe(opts.params);
    });

    it('omits pendingTxMeta when trackPendingTx is false', async () => {
        await flow(baseOpts({ trackPendingTx: false }));
        expect(submitAction.mock.calls[0][0].pendingTxMeta).toBeUndefined();
    });

    it('carries source pubkey, sourceAddress and change', async () => {
        await flow(baseOpts());
        expect(submitAction.mock.calls[0][0].encoderOpts).toEqual({
            pubkey: 'pub1',
            sourceAddress: 'addr1',
            change: 'addr1',
        });
    });

    it('adds fee, feePerKb and rbf only when defined', async () => {
        await flow(baseOpts({ fee: 0, feePerKb: 12, rbf: false }));
        expect(submitAction.mock.calls[0][0].encoderOpts).toEqual({
            pubkey: 'pub1',
            sourceAddress: 'addr1',
            change: 'addr1',
            fee: 0,
            feePerKb: 12,
            rbf: false,
        });
    });
});

describe('pending summary', () => {
    it('reads Deposit to contract', async () => {
        await depositAction(baseOpts());
        expect(submitAction.mock.calls[0][0].pendingTxMeta).toEqual({
            fromAddress: 'addr1',
            toAddress: null,
            actionSummary: 'Deposit 25 GAS to contract #7',
        });
    });

    it('reads Withdraw from contract', async () => {
        await withdrawAction(baseOpts());
        expect(submitAction.mock.calls[0][0].pendingTxMeta.actionSummary)
            .toBe('Withdraw 25 GAS from contract #7');
    });
});
