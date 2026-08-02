// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the wallet completes a Taproot envelope pair ( §6/§3.5, ).
//
// The wallet does NOT use the SDK's lifecycleManager; submitWithSigner is a
// second implementation of the same job, and it had the same gap  fixed
// in the SDK: sign one PSBT, broadcast it, and branch to a second transaction
// only for P2SH/P2WSH. A commit/reveal pair would have had its commit broadcast
// and its reveal dropped.
//
// What these tests pin is ORDER, not merely "both happen". §6: "the reveal must
// be signable before the commit is broadcast; anything else manufactures a
// stranded-funds event, not an error message". So the tests that matter most are
// the ones where something goes WRONG and nothing reaches the chain.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';
import { listPendingCommits } from '../../../packages/core/src/shared/utils/envelopeRecoveryMemory.js';

const ENVELOPE = {
    commitTxid: 'aa'.repeat(32),
    commitVout: 0,
    commitValue: 12345,
    commitAddress: 'bcrt1pexample',
    internalPubkey: 'bb'.repeat(32),
    tapleafHash: 'cc'.repeat(32),
};

function harness({ withReveal = true, revealSignThrows = false, revealBroadcastThrows = false } = {}) {
    const trace = [];
    const broadcastTx = vi.fn(async () => { trace.push('broadcast');
        if (revealBroadcastThrows && trace.filter(t => t === 'broadcast').length === 2) throw new Error('node rejected the reveal');
        return {}; });
    const signPsbt = vi.fn(async ({ envelopeReveal }) => {
        if (envelopeReveal) {
            trace.push('signReveal');
            if (revealSignThrows) throw new Error('this signer cannot sign a script path');
            return { txHex: 'reveal-hex', txid: 'REVEALTXID' };
        }
        trace.push('signCommit');
        return { txHex: 'commit-hex', txid: 'COMMITTXID' };
    });
    const encoder = {
        createTx: vi.fn(async () => ({
            psbt: '70736274ff',
            encoding: 'TAPROOT',
            ...(withReveal ? { revealPsbt: '70736274ff', envelope: ENVELOPE } : {}),
        })),
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

describe('submitWithSigner completes the envelope pair ', () => {
    beforeEach(() => { localStorage.clear(); });

    it('signs BOTH halves before anything is broadcast, then commit -> reveal', async () => {
        const h = harness();
        await call(h);
        expect(h.trace).toEqual(['signCommit', 'signReveal', 'broadcast', 'broadcast']);
    });

    it('an unsignable reveal broadcasts NOTHING', async () => {
        // the whole reason the reveal is signed first
        const h = harness({ revealSignThrows: true });
        await expect(call(h)).rejects.toThrow();
        expect(h.trace).not.toContain('broadcast');
    });

    it('persists the §3.5 recovery record BEFORE the commit is broadcast', async () => {
        const h = harness();
        await call(h);
        // the record is cleared once the reveal lands, so assert it against a run
        // where the reveal never does
        const h2 = harness({ revealBroadcastThrows: true });
        await expect(call(h2)).rejects.toThrow();
        const [rec] = listPendingCommits();
        expect(rec).toBeTruthy();
        expect(rec.commitTxid).toBe(ENVELOPE.commitTxid);
        expect(rec.tapleafHash).toBe(ENVELOPE.tapleafHash);
        expect(rec.internalKeyPath).toBe("m/86'/0'/0'/0/3");
    });

    it('clears the recovery record once the reveal is on chain', async () => {
        const h = harness();
        await call(h);
        expect(listPendingCommits()).toHaveLength(0);
    });

    it('returns the REVEAL txid as the action txid (§3.1)', async () => {
        const h = harness();
        const result = await call(h);
        expect(result.txid).toBe('REVEALTXID');
    });

    it('a rejected reveal surfaces the signed reveal so it can be retried', async () => {
        const h = harness({ revealBroadcastThrows: true });
        await expect(call(h)).rejects.toMatchObject({
            signedTxHex: 'reveal-hex',
            phase: 'envelope_reveal',
        });
    });

    it('a single-PSBT response never takes any of this path', async () => {
        const h = harness({ withReveal: false });
        await call(h).catch(() => { /* later stages out of scope */ });
        expect(h.trace).not.toContain('signReveal');
        expect(listPendingCommits()).toHaveLength(0);
    });
});
