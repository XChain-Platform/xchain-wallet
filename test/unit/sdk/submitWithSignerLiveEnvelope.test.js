// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitWithSigner, EnvelopeConfirmLaneError } from '../../../packages/core/src/sdk/submitWithSigner.js';
import { listPendingCommits } from '../../../packages/core/src/shared/utils/envelopeRecoveryMemory.js';

const ENVELOPE = {
    commitTxid: 'aa'.repeat(32),
    commitVout: 0,
    commitValue: 12345,
    commitAddress: 'bcrt1pexample',
    internalPubkey: 'bb'.repeat(32),
    tapleafHash: 'cc'.repeat(32),
};

function harness(createTxAnswer) {
    const trace = [];
    const signPsbt = vi.fn(async ({ envelopeReveal }) => {
        trace.push(envelopeReveal ? 'signReveal' : 'signCommit');
        return envelopeReveal
            ? { txHex: 'reveal-hex', txid: 'REVEALTXID' }
            : { txHex: 'commit-hex', txid: ENVELOPE.commitTxid };
    });
    const broadcastTx = vi.fn(async () => { trace.push('broadcast'); return {}; });
    const encoder = {
        createTx: vi.fn(async () => createTxAnswer),
        broadcastTx,
        spendP2sh: vi.fn(async () => ({ psbt: '70736274ff' })),
    };
    const sdkRegistry = {
        get: () => ({
            encoder,
            actions: { createAction: () => ({ actionString: 'FILE|0|a.txt|text/plain', action: 'FILE', version: 0 }) },
        }),
    };
    return { sdkRegistry, signPsbt, broadcastTx, trace };
}

const call = ({ sdkRegistry, signPsbt }) => submitWithSigner({
    sdkRegistry,
    chainId: 'BTC',
    chainRegistry: { get: () => ({}) },
    actionData: { action: 'FILE', params: {} },
    encoderOpts: { pubkey: '03abc', rawData: 'x' },
    signer: { signPsbt },
    signingPaths: [{ inputIndex: 0, path: "m/86'/0'/0'/0/3" }],
});

describe('submitWithSigner live-encode branch refuses an incomplete envelope', () => {
    beforeEach(() => { localStorage.clear(); });

    it('a TAPROOT commit with no revealPsbt at all is refused before signing', async () => {
        const h = harness({ psbt: '70736274ff', encoding: 'TAPROOT' });
        await expect(call(h)).rejects.toThrow(EnvelopeConfirmLaneError);
        expect(h.trace).toEqual([]);
        expect(h.signPsbt).not.toHaveBeenCalled();
        expect(h.broadcastTx).not.toHaveBeenCalled();
    });

    it('a TAPROOT commit with a reveal but no recovery record is refused before signing', async () => {
        const h = harness({ psbt: '70736274ff', encoding: 'TAPROOT', revealPsbt: '70736274ff' });
        await expect(call(h)).rejects.toThrow(EnvelopeConfirmLaneError);
        expect(h.trace).toEqual([]);
        expect(h.broadcastTx).not.toHaveBeenCalled();
    });

    it('a TAPROOT commit with an incomplete recovery record is refused before signing', async () => {
        const h = harness({
            psbt: '70736274ff',
            encoding: 'TAPROOT',
            revealPsbt: '70736274ff',
            envelope: { ...ENVELOPE, tapleafHash: '' },
        });
        await expect(call(h)).rejects.toThrow(EnvelopeConfirmLaneError);
        expect(h.trace).toEqual([]);
        expect(listPendingCommits()).toHaveLength(0);
    });

    it('a complete envelope pair still signs and broadcasts both halves', async () => {
        const h = harness({
            psbt: '70736274ff', encoding: 'TAPROOT', revealPsbt: '70736274ff', envelope: ENVELOPE,
        });
        await call(h);
        expect(h.trace).toEqual(['signCommit', 'signReveal', 'broadcast', 'broadcast']);
    });

    it('a single-PSBT (non-TAPROOT) answer never runs the envelope check', async () => {
        const h = harness({ psbt: '70736274ff', encoding: 'OP_RETURN' });
        await call(h);
        expect(h.trace).toEqual(['signCommit', 'broadcast']);
    });
});
