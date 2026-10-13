// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'stake-tx' })),
}));

import { stakeAction } from '../../../packages/core/src/flows/stakeAction.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const PUBKEY = 'ab'.repeat(32);
const FROM = {
    address: 'bcrt1qstaker',
    publicKey: '02'.padEnd(66, '1'),
    derivationPath: "m/84'/1'/0'/0/3",
};

function options(overrides = {}) {
    return {
        vault: { wallets: { get: vi.fn() } },
        walletId: 'wallet-1',
        password: 'secret',
        bip39Passphrase: 'extra words',
        chainRegistry: defaultRegistry(),
        sdkRegistry: { get: vi.fn() },
        chainId: 'bitcoin-regtest',
        from: FROM,
        params: { VERSION: '1', AMOUNT: '12.5', SIGNING_PUBKEY: PUBKEY },
        ...overrides,
    };
}

const lastSubmission = () => vi.mocked(submitAction).mock.calls.at(-1)[0];

describe('stakeAction', () => {
    beforeEach(() => {
        vi.mocked(submitAction).mockClear();
    });

    it.each([
        [undefined, /opts is required/],
        [{ params: null }, /params is required/],
        [{ params: { VERSION: '3', AMOUNT: '1', SIGNING_PUBKEY: PUBKEY } }, /params.VERSION/],
        [{ params: { VERSION: '1', AMOUNT: '0', SIGNING_PUBKEY: PUBKEY } }, /AMOUNT must be greater than 0/],
        [{ params: { VERSION: '1', AMOUNT: '1.000000001', SIGNING_PUBKEY: PUBKEY } }, /at most 8 fractional digits/],
        [{ params: { VERSION: '1', AMOUNT: '1', SIGNING_PUBKEY: 'xyz' } }, /64 hex chars/],
    ])('rejects invalid input before submitting %#', async (input, message) => {
        await expect(stakeAction(input)).rejects.toThrow(message);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('forwards the exact action params, mocked dependencies, and signing path', async () => {
        const signer = { sign: vi.fn() };
        const waitForTxid = vi.fn();
        const onProgress = vi.fn();
        const onBroadcastFailure = vi.fn();
        const opts = options({
            signer,
            fee: 1000,
            feePerKb: 2200,
            rbf: true,
            prebuiltPsbt: { psbtHex: 'cHNidP8=', plan: {} },
            waitForTxid,
            waitOpts: { attempts: 4 },
            onProgress,
            onBroadcastFailure,
        });

        await expect(stakeAction(opts)).resolves.toEqual({ txid: 'stake-tx' });
        expect(lastSubmission()).toMatchObject({
            vault: opts.vault,
            walletId: 'wallet-1',
            password: 'secret',
            signer,
            bip39Passphrase: 'extra words',
            chainRegistry: opts.chainRegistry,
            sdkRegistry: opts.sdkRegistry,
            chainId: 'bitcoin-regtest',
            actionData: { action: 'STAKE', params: opts.params },
            encoderOpts: {
                pubkey: FROM.publicKey,
                sourceAddress: FROM.address,
                change: FROM.address,
                fee: 1000,
                feePerKb: 2200,
                rbf: true,
            },
            signingPaths: [{ inputIndex: 0, path: FROM.derivationPath }],
            prebuiltPsbt: opts.prebuiltPsbt,
            pendingTxMeta: {
                fromAddress: FROM.address,
                toAddress: null,
                actionSummary: 'Stake 12.5 XCHAIN',
            },
            waitForTxid,
            waitOpts: { attempts: 4 },
            onProgress,
            onBroadcastFailure,
        });
    });

    it('uses an imported address id and labels a top-up without tracking metadata', async () => {
        const params = { VERSION: '2', AMOUNT: '2', SIGNING_PUBKEY: PUBKEY };
        await stakeAction(options({
            params,
            trackPendingTx: false,
            from: {
                id: 'address-9',
                address: FROM.address,
                publicKey: FROM.publicKey,
                derivationPath: null,
            },
        }));

        expect(lastSubmission().actionData).toEqual({ action: 'STAKE', params });
        expect(lastSubmission().signingPaths).toEqual([{ inputIndex: 0, addressId: 'address-9' }]);
        expect(lastSubmission().pendingTxMeta).toBeUndefined();
    });
});
