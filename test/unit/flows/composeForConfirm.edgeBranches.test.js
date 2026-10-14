// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';

function harness({ createTx, quoteNativeFee, releaseInputs } = {}) {
    const encoder = {
        createTx: createTx || vi.fn(async () => ({ psbt: 'PSBT', encoding: 'OP_RETURN' })),
        ...(releaseInputs === undefined ? {} : { releaseInputs }),
    };
    const sdk = {
        encoder,
        actions: {
            createAction: vi.fn(() => ({ actionString: 'BET|2|42|0|1', action: 'BET', version: 2 })),
        },
        wallet: { getBitcoinNetwork: () => ({ dustThreshold: 546 }) },
        ...(quoteNativeFee ? { quoteNativeFee } : {}),
    };
    return {
        encoder,
        args: {
            sdkRegistry: { get: () => sdk },
            chainRegistry: { get: () => ({ coin: 'bitcoin', networkKind: 'regtest' }) },
            vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
            chainId: 'bitcoin-regtest',
            actionData: { action: 'BET', params: { FEED_ACTION_INDEX: '42', OUTCOME: '0', AMOUNT: '1' } },
            encoderOpts: { pubkey: '02aa' },
        },
    };
}

describe('composeForConfirm encoder failure and fallback branches', () => {
    it('annotates an encoder failure with the native fee already quoted', async () => {
        const failure = Object.assign(new Error('no spendable UTXOs found for the funding address'), {
            name: 'SDKEncoderError',
            code: 'NO_UTXOS',
        });
        const h = harness({
            createTx: vi.fn(async () => { throw failure; }),
            quoteNativeFee: vi.fn(async () => ({
                supported: true,
                valid: true,
                feeDestination: 'fee-address',
                requiredFeeSats: 100_000,
                requiredFeeNative: '0.001',
            })),
        });

        const caught = await composeForConfirm({
            ...h.args,
            source: 'source-address',
            encoderOpts: { ...h.args.encoderOpts, payFeeInNativeCoin: true },
        }).catch((err) => err);

        expect(caught).toBe(failure);
        expect(caught.message).toMatch(/protocol fee requires 0.001 in native coin$/);
    });

    it('rethrows a non-encoder build failure without changing it', async () => {
        const failure = new Error('local build exploded');
        const h = harness({ createTx: vi.fn(async () => { throw failure; }) });

        const caught = await composeForConfirm(h.args).catch((err) => err);

        expect(caught).toBe(failure);
        expect(caught.message).toBe('local build exploded');
    });

    it('returns null reveal fallbacks and no release callback when the encoder cannot release', async () => {
        const h = harness({
            createTx: vi.fn(async () => ({
                psbt: 'PSBT', encoding: 'P2SH', carrierScripts: ['aa'], reservation: { id: 'r-1' },
            })),
        });

        const composed = await composeForConfirm(h.args);

        expect(composed.revealOpts).toEqual({ change: null, rawData: null });
        expect(composed.releaseEncoderInputs).toBeUndefined();
        expect(composed.carrierScripts).toEqual(['aa']);
    });

    it('ignores a release method when the encoder returned no reservation id', async () => {
        const releaseInputs = vi.fn();
        const h = harness({ releaseInputs });

        const composed = await composeForConfirm(h.args);

        expect(composed.releaseEncoderInputs).toBeUndefined();
        expect(releaseInputs).not.toHaveBeenCalled();
    });
});
