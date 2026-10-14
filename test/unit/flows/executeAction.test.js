// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { submitAction } = vi.hoisted(() => ({ submitAction: vi.fn() }));

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({ submitAction }));

import { executeAction } from '../../../packages/core/src/flows/executeAction.js';

const PARAMS = {
    VERSION: '0',
    CONTRACT_ACTION_INDEX: '42',
    METHOD: 'transfer',
    PARAMS: ['alice', '25'],
};

function baseOpts(overrides = {}) {
    return {
        vault: { wallets: { get: vi.fn() } },
        walletId: 'wallet-1',
        password: 'secret',
        chainRegistry: { get: vi.fn() },
        sdkRegistry: { get: vi.fn() },
        chainId: 'bitcoin-regtest',
        from: {
            address: 'bcrt1qsource',
            publicKey: '02abcdef',
            derivationPath: "m/84'/1'/0'/0/0",
        },
        params: { ...PARAMS },
        ...overrides,
    };
}

describe('executeAction', () => {
    beforeEach(() => {
        submitAction.mockReset();
        submitAction.mockResolvedValue({ txid: 'execute-tx' });
    });

    it.each([
        [undefined, 'executeAction: opts is required'],
        [baseOpts({ params: undefined }), 'executeAction: params is required'],
        [baseOpts({ params: { METHOD: 'run' } }), 'params.CONTRACT_ACTION_INDEX is required'],
        [baseOpts({ params: { CONTRACT_ACTION_INDEX: '42' } }), 'params.METHOD is required'],
    ])('refuses malformed options', async (value, message) => {
        await expect(executeAction(value)).rejects.toThrow(message);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('submits EXECUTE params with funding, fee, signer, and callback options', async () => {
        const signer = { id: 'signer-1' };
        const prebuiltPsbt = { psbt: 'bytes' };
        const waitForTxid = vi.fn();
        const waitOpts = { attempts: 2 };
        const onProgress = vi.fn();
        const onBroadcastFailure = vi.fn();
        const options = baseOpts({
            signer,
            bip39Passphrase: 'twenty-fifth',
            fee: 0,
            feePerKb: 1200,
            rbf: false,
            payFeeInNativeCoin: true,
            prebuiltPsbt,
            waitForTxid,
            waitOpts,
            onProgress,
            onBroadcastFailure,
        });

        await expect(executeAction(options)).resolves.toEqual({ txid: 'execute-tx' });

        expect(submitAction).toHaveBeenCalledWith({
            vault: options.vault,
            walletId: 'wallet-1',
            password: 'secret',
            signer,
            bip39Passphrase: 'twenty-fifth',
            chainRegistry: options.chainRegistry,
            sdkRegistry: options.sdkRegistry,
            chainId: 'bitcoin-regtest',
            actionData: { action: 'EXECUTE', params: options.params },
            encoderOpts: {
                pubkey: '02abcdef',
                sourceAddress: 'bcrt1qsource',
                change: 'bcrt1qsource',
                fee: 0,
                feePerKb: 1200,
                rbf: false,
                payFeeInNativeCoin: true,
            },
            signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
            prebuiltPsbt,
            pendingTxMeta: {
                fromAddress: 'bcrt1qsource',
                toAddress: null,
                actionSummary: 'Execute transfer (2 args) on contract #42',
            },
            waitForTxid,
            waitOpts,
            onProgress,
            onBroadcastFailure,
        });
    });

    it('uses singular argument wording', async () => {
        await executeAction(baseOpts({
            params: { ...PARAMS, PARAMS: ['only'] },
        }));

        expect(submitAction.mock.calls[0][0].pendingTxMeta.actionSummary)
            .toBe('Execute transfer (1 arg) on contract #42');
    });

    it('uses an address id for imported WIF signing and can omit pending metadata', async () => {
        await executeAction(baseOpts({
            from: {
                id: 'address-1',
                source: 'imported-wif',
                address: 'mimported',
                publicKey: '03abcdef',
                derivationPath: null,
            },
            trackPendingTx: false,
        }));

        expect(submitAction.mock.calls[0][0]).toMatchObject({
            encoderOpts: {
                pubkey: '03abcdef',
                sourceAddress: 'mimported',
                change: 'mimported',
            },
            signingPaths: [{ inputIndex: 0, addressId: 'address-1' }],
            pendingTxMeta: undefined,
        });
    });

    it('rejects a watch-only source before submission', async () => {
        await expect(executeAction(baseOpts({
            from: {
                source: 'watch-only',
                address: 'bcrt1qwatch',
                publicKey: '02abcdef',
                derivationPath: null,
            },
        }))).rejects.toThrow('executeAction: from.source = "watch-only"');
        expect(submitAction).not.toHaveBeenCalled();
    });
});
