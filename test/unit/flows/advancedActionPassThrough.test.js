// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'advanced-tx' })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { advancedAction } from '../../../packages/core/src/flows/advancedAction.js';

const FROM = {
    address: 'source-address',
    publicKey: '02aa',
    derivationPath: "m/84'/1'/0'/0/0",
};

function actionOpts(extra = {}) {
    return {
        vault: {},
        walletId: 'wallet-1',
        password: 'password',
        chainRegistry: {},
        sdkRegistry: {},
        chainId: 'bitcoin-regtest',
        from: FROM,
        action: 'broadcast',
        params: {},
        trackPendingTx: false,
        ...extra,
    };
}

describe('advancedAction submit options', () => {
    beforeEach(() => {
        vi.mocked(submitAction).mockClear();
    });

    it('forwards an explicit ads payout choice and a before-broadcast hook', async () => {
        const beforeBroadcast = vi.fn();

        await advancedAction(actionOpts({ adsPayout: false, beforeBroadcast }));

        expect(submitAction).toHaveBeenCalledOnce();
        expect(vi.mocked(submitAction).mock.calls[0][0]).toMatchObject({
            adsPayout: false,
            beforeBroadcast,
            verifyBuiltTx: true,
        });
    });

    it('leaves optional submit defaults intact when the caller omits both options', async () => {
        await advancedAction(actionOpts());

        const submitted = vi.mocked(submitAction).mock.calls[0][0];
        expect(submitted).not.toHaveProperty('adsPayout');
        expect(submitted).not.toHaveProperty('beforeBroadcast');
        expect(submitted.verifyBuiltTx).toBe(true);
    });
});
