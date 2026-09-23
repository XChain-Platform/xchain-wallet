// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The single-encode (prebuilt) lane carries ONE PSBT, so a TAPROOT envelope,
// which is a commit plus a reveal, is refused before anything is signed.

import { describe, it, expect, vi } from 'vitest';
import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';
import {
    submitWithSigner,
    EnvelopeConfirmLaneError,
    isEnvelopePair,
} from '../../../packages/core/src/sdk/submitWithSigner.js';
import { isWatcherChunkLane } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

function composeHarness(answer) {
    const createTx = vi.fn(async () => answer);
    const createAction = vi.fn(() => ({ actionString: 'FILE|0|a.png|image/png', action: 'FILE', version: 0 }));
    const sdk = { encoder: { createTx }, actions: { createAction } };
    return {
        createTx,
        args: {
            sdkRegistry: { get: () => sdk },
            chainRegistry: { get: () => ({ coin: 'BTC', networkKind: 'regtest', adsDonationAddress: 'X'.repeat(34) }) },
            vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
            chainId: 'btc',
            actionData: { action: 'FILE', params: {} },
            encoderOpts: { pubkey: 'pub', change: 'chg', rawData: 'aa' },
            source: 'chg',
        },
    };
}

describe('composeForConfirm refuses a TAPROOT envelope', () => {
    it('rejects a commit/reveal pair with EnvelopeConfirmLaneError', async () => {
        const h = composeHarness({
            psbt: 'COMMIT', encoding: 'TAPROOT', revealPsbt: 'REVEAL', envelope: { commitTxid: 'aa' },
        });
        await expect(composeForConfirm(h.args)).rejects.toBeInstanceOf(EnvelopeConfirmLaneError);
    });

    it('rejects an envelope-only answer with no revealPsbt', async () => {
        const h = composeHarness({ psbt: 'COMMIT', encoding: 'TAPROOT', envelope: { commitTxid: 'aa' } });
        await expect(composeForConfirm(h.args)).rejects.toThrow(/TAPROOT pair/);
    });

    it('rejects a revealPsbt under an unexpected encoding label', async () => {
        const h = composeHarness({ psbt: 'COMMIT', encoding: 'OP_RETURN', revealPsbt: 'REVEAL' });
        await expect(composeForConfirm(h.args)).rejects.toBeInstanceOf(EnvelopeConfirmLaneError);
    });

    it('still composes a single-PSBT answer unchanged', async () => {
        const h = composeHarness({ psbt: 'PSBTHEX', encoding: 'OP_RETURN' });
        const composed = await composeForConfirm(h.args);
        expect(composed.psbt).toBe('PSBTHEX');
        expect(composed.encoding).toBe('OP_RETURN');
    });

    it('surfaces the refusal through the chunk-lane message branch after serialization', () => {
        const err = new EnvelopeConfirmLaneError({ action: 'FILE', encoding: 'TAPROOT' });
        expect(err.userFacing).toBe(true);
        expect(isWatcherChunkLane({ name: err.name, message: err.message })).toBe(true);
        expect(isWatcherChunkLane({ name: 'Error', message: err.message })).toBe(true);
    });
});

describe('isEnvelopePair', () => {
    it('reads the encoder answer, not a predicted encoding list', () => {
        expect(isEnvelopePair({ encoding: 'TAPROOT' })).toBe(true);
        expect(isEnvelopePair({ encoding: 'P2SH', revealPsbt: 'R' })).toBe(true);
        expect(isEnvelopePair({ encoding: 'OP_RETURN', envelope: {} })).toBe(true);
        expect(isEnvelopePair({ encoding: 'P2SH' })).toBe(false);
        expect(isEnvelopePair({ encoding: 'OP_RETURN' })).toBe(false);
        expect(isEnvelopePair(null)).toBe(false);
    });
});

function submitHarness(prebuiltPsbt) {
    const broadcastTx = vi.fn(async () => ({ txid: 'txid-1' }));
    const sdk = {
        encoder: { createTx: vi.fn(), broadcastTx },
        actions: { createAction: vi.fn() },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
    };
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` })),
    };
    return {
        signer,
        args: {
            sdkRegistry: { get: () => sdk },
            chainId: 'bitcoin-regtest',
            actionData: { action: 'FILE', params: {} },
            encoderOpts: { pubkey: 'pub', change: 'chg' },
            signer,
            signingPaths: [{ inputIndex: 0, path: 'm/0' }],
            prebuiltPsbt,
        },
    };
}

describe('submitWithSigner prebuilt branch refuses a TAPROOT envelope', () => {
    it('throws before signing when the prebuilt PSBT is an envelope commit', async () => {
        const h = submitHarness({ psbtHex: 'COMMIT', encoding: 'TAPROOT', actionString: 'FILE|0|a.png' });
        await expect(submitWithSigner(h.args)).rejects.toBeInstanceOf(EnvelopeConfirmLaneError);
        expect(h.signer.signPsbt).not.toHaveBeenCalled();
    });

    it('throws before signing when a reveal rides the prebuilt PSBT', async () => {
        const h = submitHarness({
            psbtHex: 'COMMIT', encoding: 'OP_RETURN', actionString: 'FILE|0|a.png', revealPsbt: 'REVEAL',
        });
        await expect(submitWithSigner(h.args)).rejects.toBeInstanceOf(EnvelopeConfirmLaneError);
        expect(h.signer.signPsbt).not.toHaveBeenCalled();
    });

    it('signs a single-PSBT prebuilt answer as before', async () => {
        const h = submitHarness({ psbtHex: 'PSBTHEX', encoding: 'OP_RETURN', actionString: 'FILE|0|a.png' });
        await submitWithSigner(h.args);
        expect(h.signer.signPsbt).toHaveBeenCalledOnce();
        expect(h.signer.signPsbt.mock.calls[0][0].psbtHex).toBe('PSBTHEX');
    });
});
