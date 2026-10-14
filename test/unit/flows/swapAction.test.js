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
    submitAction: vi.fn(async () => ({ txid: 'swap-tx-1' })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { swapAction } from '../../../packages/core/src/flows/swapAction.js';

const FROM = {
    address: 'bcrt1qswapmaker',
    publicKey: '03abcdef',
    derivationPath: "m/84'/1'/0'/0/4",
};

const CREATE = {
    VERSION: '0',
    GIVE_COIN: 'BTC',
    GIVE_TICK: 'ALPHA',
    GIVE_AMOUNT: '10',
    GET_COIN: 'BTC',
    GET_TICK: 'BETA',
    GET_AMOUNT: '25',
    GET_ADDRESS: 'bcrt1qsettlement',
};

function options(overrides = {}) {
    return {
        vault: { wallets: { get: vi.fn() } },
        walletId: 'wallet-1',
        password: 'secret',
        bip39Passphrase: 'hidden words',
        chainRegistry: { get: vi.fn() },
        sdkRegistry: { get: vi.fn() },
        chainId: 'bitcoin-regtest',
        from: FROM,
        params: CREATE,
        ...overrides,
    };
}

const lastSubmission = () => vi.mocked(submitAction).mock.calls.at(-1)[0];

describe('swapAction', () => {
    beforeEach(() => {
        vi.mocked(submitAction).mockClear();
    });

    it.each([
        [undefined, /opts is required/],
        [{ params: null }, /params is required/],
        [{ params: {} }, /GIVE_TICK is required/],
        [{ params: { GIVE_TICK: 'ALPHA' } }, /GIVE_AMOUNT is required/],
        [{ params: { GIVE_TICK: 'ALPHA', GIVE_AMOUNT: '1' } }, /GET_TICK is required/],
        [{ params: { GIVE_TICK: 'ALPHA', GIVE_AMOUNT: '1', GET_TICK: 'BETA' } }, /GET_AMOUNT is required/],
    ])('rejects an incomplete create request %#', async (input, message) => {
        await expect(swapAction(input)).rejects.toThrow(message);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('forwards the action, mocked dependencies, funding source, and lifecycle hooks', async () => {
        const signer = { sign: vi.fn() };
        const waitForTxid = vi.fn();
        const onProgress = vi.fn();
        const onBroadcastFailure = vi.fn();
        const opts = options({
            signer,
            fee: 1200,
            feePerKb: 3500,
            rbf: true,
            payFeeInNativeCoin: true,
            prebuiltPsbt: { psbt: 'cHNidP8=', plan: {} },
            waitForTxid,
            waitOpts: { attempts: 2 },
            onProgress,
            onBroadcastFailure,
        });

        await expect(swapAction(opts)).resolves.toEqual({ txid: 'swap-tx-1' });
        expect(lastSubmission()).toMatchObject({
            vault: opts.vault,
            walletId: 'wallet-1',
            password: 'secret',
            signer,
            bip39Passphrase: 'hidden words',
            chainRegistry: opts.chainRegistry,
            sdkRegistry: opts.sdkRegistry,
            chainId: 'bitcoin-regtest',
            actionData: { action: 'SWAP', params: CREATE },
            encoderOpts: {
                pubkey: FROM.publicKey,
                sourceAddress: FROM.address,
                change: FROM.address,
                fee: 1200,
                feePerKb: 3500,
                rbf: true,
                payFeeInNativeCoin: true,
            },
            signingPaths: [{ inputIndex: 0, path: FROM.derivationPath }],
            prebuiltPsbt: opts.prebuiltPsbt,
            waitForTxid,
            waitOpts: { attempts: 2 },
            onProgress,
            onBroadcastFailure,
        });
    });

    it('uses an address id to sign for an imported key', async () => {
        await swapAction(options({
            from: {
                id: 'address-7',
                address: FROM.address,
                publicKey: FROM.publicKey,
                derivationPath: null,
            },
        }));

        expect(lastSubmission().signingPaths).toEqual([{ inputIndex: 0, addressId: 'address-7' }]);
    });

    it('builds a create summary and settlement destination', async () => {
        await swapAction(options());

        expect(lastSubmission().pendingTxMeta).toEqual({
            fromAddress: FROM.address,
            toAddress: CREATE.GET_ADDRESS,
            actionSummary: 'Swap: give 10 ALPHA, get 25 BETA',
        });
    });

    it('allows ownership trades without an amount on the owned sides', async () => {
        const params = {
            VERSION: '0',
            GIVE_TICK: 'ALPHA',
            GIVE_OWNERSHIP: '1',
            GET_TICK: 'BETA',
            GET_OWNERSHIP: '1',
        };
        await swapAction(options({ params }));

        expect(lastSubmission().pendingTxMeta.actionSummary)
            .toBe('Swap: give ownership of ALPHA, get ownership of BETA');
    });

    it.each([
        ['1', 'Cancel swap #812'],
        ['2', 'Edit swap #812'],
    ])('accepts a version %s index operation and labels it', async (version, summary) => {
        const params = { VERSION: version, SWAP_ACTION_INDEX: '812' };
        await swapAction(options({ params }));

        expect(lastSubmission().actionData).toEqual({ action: 'SWAP', params });
        expect(lastSubmission().pendingTxMeta.actionSummary).toBe(summary);
    });

    it('omits pending metadata when tracking is disabled', async () => {
        await swapAction(options({ trackPendingTx: false }));

        expect(lastSubmission().pendingTxMeta).toBeUndefined();
    });
});
