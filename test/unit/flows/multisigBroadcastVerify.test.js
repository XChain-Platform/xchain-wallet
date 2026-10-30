// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A finalized multisig transaction carries cosigner signatures, or arrives
// whole from another coordinator, so its broadcast verifies every signature
// first: against the session PSBT's prevouts, or the UTXO tracker's when the
// PSBT does not decompose. A refusal sends nothing and leaves the session
// finalized.

import { describe, expect, it, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import { finalizeMultisigSigningSession } from '../../../packages/core/src/flows/multisigSigning.js';
import { SIGNATURE_MISMATCH_MESSAGE } from '../../../packages/core/src/signers/verifyInputSignatures.js';
import { signedTxFor, trackerFor } from '../../helpers/signedTx.js';

/** A finalized session holding `built`, with a PSBT that decomposes to `psbtPrevouts` (or does not). */
function harness(built, { psbtPrevouts = built.prevouts, listed = [] } = {}) {
    const session = {
        id: 'session-1',
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        status: 'finalized',
        psbtHex: '70736274ff01',
        finalizedTxHex: built.txHex,
        txid: null,
        cosignerPubkeys: [],
    };
    const records = new Map([[session.id, session]]);
    const put = vi.fn(async (record) => records.set(record.id, record));
    const broadcastTx = vi.fn(async () => ({ txid: 'ee'.repeat(32) }));
    const tracker = trackerFor(listed, networks.regtest);
    const sdk = {
        encoder: { broadcastTx, getUTXOs: tracker.getUTXOs },
        wallet: {
            getBitcoinNetwork: () => networks.regtest,
            decomposePsbt: () => {
                if (!psbtPrevouts) throw new Error('opaque transport payload');
                return { inputs: psbtPrevouts };
            },
        },
    };
    const run = () => finalizeMultisigSigningSession({
        vault: { multisigSigningSessions: { get: async (id) => records.get(id) || null, put } },
        sdkRegistry: { get: () => sdk },
        sessionId: session.id,
        broadcast: true,
    });
    return { run, records, put, broadcastTx, tracker };
}

async function expectRefused(h) {
    await expect(h.run()).rejects.toMatchObject({ name: 'SignatureMismatchError', message: SIGNATURE_MISMATCH_MESSAGE });
    expect(h.broadcastTx).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
    expect(h.records.get('session-1').status).toBe('finalized');
}

describe('multisig broadcast verifies the finalized signatures', () => {
    for (const type of ['p2sh-multisig', 'p2wsh-multisig', 'p2sh-p2wsh-multisig', 'p2tr']) {
        it(`broadcasts a valid ${type} spend against the session PSBT`, async () => {
            const h = harness(signedTxFor({ inputs: [{ type }, { type }] }));
            const next = await h.run();
            expect(h.broadcastTx).toHaveBeenCalledOnce();
            expect(next.status).toBe('broadcast');
            expect(h.tracker.reads).toEqual([]);
        });

        it(`refuses a ${type} spend with a tampered signature`, async () => {
            await expectRefused(harness(signedTxFor({ inputs: [{ type }, { type }], tamper: { input: 1, kind: 'flip' } })));
        });
    }

    it('refuses cosigner signatures out of key order', async () => {
        await expectRefused(harness(signedTxFor({ inputs: [{ type: 'p2wsh-multisig' }], tamper: { input: 0, kind: 'swap' } })));
    });

    it('refuses a finalized transaction that spends other coins than the session PSBT', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2wsh-multisig' }] });
        await expectRefused(harness(built, { psbtPrevouts: [{ ...built.prevouts[0], prevTxIndex: 2 }] }));
    });

    it('falls back to the tracker when the session PSBT does not decompose', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2wsh-multisig' }, { type: 'p2sh-multisig' }] });
        const h = harness(built, { psbtPrevouts: null, listed: built.prevouts });
        const next = await h.run();
        expect(next.status).toBe('broadcast');
        expect(h.tracker.reads).toHaveLength(2);
    });

    it('refuses when neither the PSBT nor the tracker establishes the coins', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2tr' }] });
        await expectRefused(harness(built, { psbtPrevouts: null, listed: built.prevouts }));
    });
});
