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
    submitAction: vi.fn(async () => ({ txid: 'issue-tx' })),
}));

import { issueToken } from '../../../packages/core/src/flows/issueToken.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';

const source = {
    address: 'bcrt1qissuer',
    publicKey: '02' + 'ab'.repeat(32),
    derivationPath: "m/84'/1'/0'/0/4",
};

function options(extra = {}) {
    return {
        vault: { marker: 'storage' },
        walletId: 'wallet-1',
        password: 'secret',
        chainRegistry: { marker: 'chains' },
        sdkRegistry: { marker: 'sdk' },
        chainId: 'bitcoin-regtest',
        from: source,
        params: { TICK: 'UNIT', MAX_SUPPLY: '1000', TRANSFER: 'bcrt1qowner' },
        ...extra,
    };
}

describe('issueToken flow', () => {
    beforeEach(() => vi.mocked(submitAction).mockClear());

    it('forwards the original ISSUE params and source signing path to submitAction', async () => {
        const opts = options({ fee: 12, feePerKb: 34, rbf: true, payFeeInNativeCoin: true });

        await expect(issueToken(opts)).resolves.toEqual({ txid: 'issue-tx' });
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.vault).toBe(opts.vault);
        expect(call.sdkRegistry).toBe(opts.sdkRegistry);
        expect(call.actionData).toEqual({ action: 'ISSUE', params: opts.params });
        expect(call.actionData.params).toBe(opts.params);
        expect(call.encoderOpts).toEqual({
            pubkey: source.publicKey,
            sourceAddress: source.address,
            change: source.address,
            fee: 12,
            feePerKb: 34,
            rbf: true,
            payFeeInNativeCoin: true,
        });
        expect(call.signingPaths).toEqual([{ inputIndex: 0, path: source.derivationPath }]);
        expect(call.pendingTxMeta).toEqual({
            fromAddress: source.address,
            toAddress: 'bcrt1qowner',
            actionSummary: 'Create token UNIT with max supply 1000',
        });
    });

    it('uses an imported address id and can suppress pending transaction storage', async () => {
        const imported = { address: 'mimported', publicKey: '03' + 'cd'.repeat(32), id: 'address-7' };
        await issueToken(options({
            from: imported,
            params: { TICK: 'UNIT' },
            trackPendingTx: false,
        }));

        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.signingPaths).toEqual([{ inputIndex: 0, addressId: 'address-7' }]);
        expect(call.pendingTxMeta).toBeUndefined();
    });

    it('rejects missing token parameters without reaching storage or the SDK', async () => {
        await expect(issueToken(options({ params: { TICK: '' } }))).rejects.toThrow(
            'issueToken: params.TICK is required',
        );
        expect(submitAction).not.toHaveBeenCalled();
    });
});
