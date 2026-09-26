// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The single-encode (prebuilt) lane carries a TAPROOT envelope whole: the
// commit PSBT, the reveal PSBT and the recovery record. What it still refuses,
// before anything is signed, is an envelope missing one of those parts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';
import {
    submitWithSigner,
    EnvelopeConfirmLaneError,
    isEnvelopePair,
    isCompleteEnvelope,
} from '../../../packages/core/src/sdk/submitWithSigner.js';
import { isWatcherChunkLane } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import { listPendingCommits } from '../../../packages/core/src/shared/utils/envelopeRecoveryMemory.js';

const ENVELOPE = Object.freeze({
    commitTxid: 'aa'.repeat(32),
    commitVout: 1,
    commitValue: 12345,
    commitAddress: 'bcrt1pcommit',
    internalPubkey: 'bb'.repeat(32),
    tapleafHash: 'cc'.repeat(32),
});

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
            encoderOpts: { pubkey: 'pub', change: 'chg', rawData: 'aa', encoding: 'AUTO' },
            source: 'chg',
        },
    };
}

describe('composeForConfirm carries a complete TAPROOT envelope', () => {
    it('returns the commit, the reveal and the recovery record the encoder built', async () => {
        const h = composeHarness({
            psbt: 'COMMIT', encoding: 'TAPROOT', revealPsbt: 'REVEAL', envelope: { ...ENVELOPE },
        });
        const composed = await composeForConfirm(h.args);
        expect(composed.psbt).toBe('COMMIT');
        expect(composed.encoding).toBe('TAPROOT');
        expect(composed.revealPsbt).toBe('REVEAL');
        expect(composed.envelope).toEqual(ENVELOPE);
        // Not a chunk lane: nothing is deferred to a rebuilt reveal.
        expect(composed.revealOpts).toBe(null);
        expect(composed.deferredOutputs).toEqual([]);
    });

    it('expects the commit output at exactly the address and value the record names', async () => {
        const h = composeHarness({
            psbt: 'COMMIT', encoding: 'TAPROOT', revealPsbt: 'REVEAL', envelope: { ...ENVELOPE },
        });
        const composed = await composeForConfirm(h.args);
        expect(composed.expectedOutputs.encoding).toBe('TAPROOT');
        expect(composed.expectedOutputs.carrierAllowance).toBe(0);
        expect(composed.expectedOutputs.addressed).toEqual([
            { address: ENVELOPE.commitAddress, value: ENVELOPE.commitValue, isAds: false },
        ]);
    });

    it('refuses an envelope-only answer with no revealPsbt', async () => {
        const h = composeHarness({ psbt: 'COMMIT', encoding: 'TAPROOT', envelope: { ...ENVELOPE } });
        await expect(composeForConfirm(h.args)).rejects.toBeInstanceOf(EnvelopeConfirmLaneError);
        await expect(composeForConfirm(h.args)).rejects.toThrow(/TAPROOT pair/);
    });

    it('refuses a reveal that arrives without its recovery record', async () => {
        const h = composeHarness({ psbt: 'COMMIT', encoding: 'TAPROOT', revealPsbt: 'REVEAL' });
        await expect(composeForConfirm(h.args)).rejects.toBeInstanceOf(EnvelopeConfirmLaneError);
    });

    it('refuses a recovery record missing the tapleaf hash the cancel is rebuilt from', async () => {
        const { tapleafHash, ...partial } = ENVELOPE;
        expect(tapleafHash).toBeTruthy();
        const h = composeHarness({ psbt: 'COMMIT', encoding: 'TAPROOT', revealPsbt: 'REVEAL', envelope: partial });
        await expect(composeForConfirm(h.args)).rejects.toBeInstanceOf(EnvelopeConfirmLaneError);
    });

    it('refuses a revealPsbt under an unexpected encoding label', async () => {
        const h = composeHarness({ psbt: 'COMMIT', encoding: 'OP_RETURN', revealPsbt: 'REVEAL', envelope: { ...ENVELOPE } });
        await expect(composeForConfirm(h.args)).rejects.toBeInstanceOf(EnvelopeConfirmLaneError);
    });

    it('still composes a single-PSBT answer unchanged, with no envelope fields', async () => {
        const h = composeHarness({ psbt: 'PSBTHEX', encoding: 'OP_RETURN' });
        const composed = await composeForConfirm(h.args);
        expect(composed.psbt).toBe('PSBTHEX');
        expect(composed.encoding).toBe('OP_RETURN');
        expect(composed.revealPsbt).toBe(null);
        expect(composed.envelope).toBe(null);
    });

    it('surfaces the refusal through the chunk-lane message branch after serialization', () => {
        const err = new EnvelopeConfirmLaneError({ action: 'FILE', encoding: 'TAPROOT' });
        expect(err.userFacing).toBe(true);
        expect(isWatcherChunkLane({ name: err.name, message: err.message })).toBe(true);
        expect(isWatcherChunkLane({ name: 'Error', message: err.message })).toBe(true);
    });
});

describe('isEnvelopePair and isCompleteEnvelope', () => {
    it('reads the encoder answer, not a predicted encoding list', () => {
        expect(isEnvelopePair({ encoding: 'TAPROOT' })).toBe(true);
        expect(isEnvelopePair({ encoding: 'P2SH', revealPsbt: 'R' })).toBe(true);
        expect(isEnvelopePair({ encoding: 'OP_RETURN', envelope: {} })).toBe(true);
        expect(isEnvelopePair({ encoding: 'P2SH' })).toBe(false);
        expect(isEnvelopePair({ encoding: 'OP_RETURN' })).toBe(false);
        expect(isEnvelopePair(null)).toBe(false);
    });

    it('calls a pair complete only with the label, the reveal and every recovery field', () => {
        expect(isCompleteEnvelope({ encoding: 'TAPROOT', revealPsbt: 'R', envelope: ENVELOPE })).toBe(true);
        expect(isCompleteEnvelope({ psbtHex: 'C', encoding: 'TAPROOT', revealPsbt: 'R', envelope: ENVELOPE })).toBe(true);
        expect(isCompleteEnvelope({ encoding: 'TAPROOT', revealPsbt: '', envelope: ENVELOPE })).toBe(false);
        expect(isCompleteEnvelope({ encoding: 'TAPROOT', revealPsbt: 'R', envelope: null })).toBe(false);
        expect(isCompleteEnvelope({ encoding: 'P2WSH', revealPsbt: 'R', envelope: ENVELOPE })).toBe(false);
        expect(isCompleteEnvelope({ encoding: 'TAPROOT', revealPsbt: 'R', envelope: { ...ENVELOPE, commitVout: '1' } })).toBe(false);
        expect(isCompleteEnvelope({ encoding: 'TAPROOT', revealPsbt: 'R', envelope: { ...ENVELOPE, commitTxid: '' } })).toBe(false);
        expect(isCompleteEnvelope({ encoding: 'OP_RETURN' })).toBe(false);
    });
});

function submitHarness(prebuiltPsbt) {
    const trace = [];
    const broadcastTx = vi.fn(async (hex) => {
        trace.push({ step: 'broadcast', hex, pending: listPendingCommits().map((r) => r.commitTxid) });
        return { txid: 'txid-1' };
    });
    const createTx = vi.fn();
    const sdk = {
        encoder: { createTx, broadcastTx },
        actions: { createAction: vi.fn() },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
    };
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex, envelopeReveal }) => {
            trace.push({ step: envelopeReveal ? 'signReveal' : 'signCommit', psbtHex });
            // The commit's real txid is the one the recovery record names.
            return { txHex: `TX(${psbtHex})`, txid: psbtHex === 'COMMIT' ? ENVELOPE.commitTxid : `txid-${psbtHex}` };
        }),
    };
    return {
        signer,
        trace,
        createTx,
        broadcastTx,
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

describe('submitWithSigner prebuilt branch carries a TAPROOT envelope', () => {
    beforeEach(() => { localStorage.clear(); });

    it('signs the prebuilt commit and reveal byte-identically, records, then broadcasts commit then reveal', async () => {
        const h = submitHarness({
            psbtHex: 'COMMIT', encoding: 'TAPROOT', actionString: 'FILE|0|a.png',
            revealPsbt: 'REVEAL', envelope: { ...ENVELOPE },
        });
        const result = await submitWithSigner(h.args);
        expect(h.createTx).not.toHaveBeenCalled();
        expect(h.trace.map((t) => t.step)).toEqual(['signCommit', 'signReveal', 'broadcast', 'broadcast']);
        expect(h.trace[0].psbtHex).toBe('COMMIT');
        expect(h.trace[1].psbtHex).toBe('REVEAL');
        expect(h.trace[2]).toMatchObject({ hex: 'TX(COMMIT)', pending: [ENVELOPE.commitTxid] });
        expect(h.trace[3].hex).toBe('TX(REVEAL)');
        expect(result.txid).toBe('txid-REVEAL');
        expect(result.encoding).toBe('TAPROOT');
        expect(listPendingCommits()).toHaveLength(0);
    });

    it('keeps the recovery record when the reveal broadcast fails', async () => {
        const h = submitHarness({
            psbtHex: 'COMMIT', encoding: 'TAPROOT', actionString: 'FILE|0|a.png',
            revealPsbt: 'REVEAL', envelope: { ...ENVELOPE },
        });
        h.broadcastTx.mockImplementationOnce(async () => ({})).mockImplementationOnce(async () => {
            throw new Error('node rejected the reveal');
        });
        await expect(submitWithSigner(h.args)).rejects.toMatchObject({
            signedTxHex: 'TX(REVEAL)', phase: 'envelope_reveal',
        });
        const [rec] = listPendingCommits();
        expect(rec).toMatchObject({ commitTxid: ENVELOPE.commitTxid, commitVout: 1, tapleafHash: ENVELOPE.tapleafHash, internalKeyPath: 'm/0' });
    });

    it('broadcasts nothing when the reveal cannot be signed', async () => {
        const h = submitHarness({
            psbtHex: 'COMMIT', encoding: 'TAPROOT', actionString: 'FILE|0|a.png',
            revealPsbt: 'REVEAL', envelope: { ...ENVELOPE },
        });
        h.signer.signPsbt.mockImplementation(async ({ envelopeReveal }) => {
            if (envelopeReveal) throw new Error('this signer cannot sign a script path');
            return { txHex: 'TX(COMMIT)', txid: ENVELOPE.commitTxid };
        });
        await expect(submitWithSigner(h.args)).rejects.toThrow(/script path/);
        expect(h.broadcastTx).not.toHaveBeenCalled();
    });

    it('broadcasts nothing when the signed commit is not the one the reveal spends', async () => {
        const h = submitHarness({
            psbtHex: 'COMMIT', encoding: 'TAPROOT', actionString: 'FILE|0|a.png',
            revealPsbt: 'REVEAL', envelope: { ...ENVELOPE },
        });
        h.signer.signPsbt.mockImplementation(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: 'dd'.repeat(32) }));
        const err = await submitWithSigner(h.args).catch((e) => e);
        expect(err).toBeInstanceOf(EnvelopeConfirmLaneError);
        expect(err.commitMismatch).toBe(true);
        expect(isWatcherChunkLane({ name: err.name, message: err.message })).toBe(true);
        // Only the commit was signed; the reveal never was, and nothing went out.
        expect(h.signer.signPsbt).toHaveBeenCalledTimes(1);
        expect(h.broadcastTx).not.toHaveBeenCalled();
        expect(listPendingCommits()).toHaveLength(0);
    });

    it('refuses before signing when the prebuilt commit lost its reveal', async () => {
        const h = submitHarness({
            psbtHex: 'COMMIT', encoding: 'TAPROOT', actionString: 'FILE|0|a.png', revealPsbt: null, envelope: null,
        });
        await expect(submitWithSigner(h.args)).rejects.toBeInstanceOf(EnvelopeConfirmLaneError);
        expect(h.signer.signPsbt).not.toHaveBeenCalled();
        expect(h.broadcastTx).not.toHaveBeenCalled();
    });

    it('refuses before signing when the reveal arrives without its recovery record', async () => {
        const h = submitHarness({
            psbtHex: 'COMMIT', encoding: 'TAPROOT', actionString: 'FILE|0|a.png', revealPsbt: 'REVEAL',
        });
        await expect(submitWithSigner(h.args)).rejects.toBeInstanceOf(EnvelopeConfirmLaneError);
        expect(h.signer.signPsbt).not.toHaveBeenCalled();
    });

    it('refuses before signing when a reveal rides a non-TAPROOT label', async () => {
        const h = submitHarness({
            psbtHex: 'COMMIT', encoding: 'OP_RETURN', actionString: 'FILE|0|a.png',
            revealPsbt: 'REVEAL', envelope: { ...ENVELOPE },
        });
        await expect(submitWithSigner(h.args)).rejects.toBeInstanceOf(EnvelopeConfirmLaneError);
        expect(h.signer.signPsbt).not.toHaveBeenCalled();
    });

    it('signs a single-PSBT prebuilt answer as before', async () => {
        const h = submitHarness({
            psbtHex: 'PSBTHEX', encoding: 'OP_RETURN', actionString: 'FILE|0|a.png', revealPsbt: null, envelope: null,
        });
        await submitWithSigner(h.args);
        expect(h.signer.signPsbt).toHaveBeenCalledOnce();
        expect(h.signer.signPsbt.mock.calls[0][0].psbtHex).toBe('PSBTHEX');
        expect(h.signer.signPsbt.mock.calls[0][0].envelopeReveal).toBeUndefined();
    });
});
