// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Two windows, or two quick replies, drive one signing session at the same
// moment. The vault is asynchronous (IndexedDB), so every read-modify-write on
// a session must run one at a time or the later write erases the earlier one.

import { describe, expect, it, vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import {
    cancelMultisigSigningSession,
    contributeMultisigSignature,
    finalizeMultisigSigningSession,
    startMultisigSigningSession,
} from '../../../packages/core/src/flows/multisigSigning.js';
import { signedTxFor } from '../../helpers/signedTx.js';

const MSG_HASH = '11'.repeat(32);
const key = (byte) => ({ sk: byte.repeat(32), pub: Buffer.from(secp256k1.getPublicKey(byte.repeat(32), true)).toString('hex') });
const [A, B, C] = [key('0a'), key('0b'), key('0c')];
const ALICE = A.pub;
const BOB = B.pub;
const CAROL = C.pub;
// Replies are counted only when they verify, so these are real signatures of MSG_HASH.
const SIG_A = secp256k1.sign(MSG_HASH, A.sk, { lowS: true }).toDERHex();
const SIG_B = secp256k1.sign(MSG_HASH, B.sk, { lowS: true }).toDERHex();

// A vault whose reads and writes each yield to the event loop, like IndexedDB.
function slowVault(scheme = 'p2wsh-multisig') {
    const records = new Map();
    const wallet = {
        id: 'wallet-1',
        multisigs: [{
            id: 'config-1',
            scheme,
            threshold: 2,
            cosigners: [{ pubkey: ALICE }, { pubkey: BOB }, { pubkey: CAROL }],
        }],
    };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    return {
        records,
        vault: {
            wallets: { get: vi.fn(async (id) => (id === wallet.id ? wallet : null)) },
            multisigSigningSessions: {
                get: vi.fn(async (id) => { await tick(); return structuredClone(records.get(id) || null); }),
                list: vi.fn(async () => [...records.values()]),
                put: vi.fn(async (record) => { await tick(); records.set(record.id, structuredClone(record)); }),
            },
        },
    };
}

async function start(vault) {
    return startMultisigSigningSession({
        vault,
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        msgHash: MSG_HASH,
        psbtHex: '70736274ff',
    });
}

describe('multisig session concurrent writes', () => {
    it('keeps both signatures when two cosigners reply at once', async () => {
        const { vault, records } = slowVault();
        const session = await start(vault);
        await Promise.all([
            contributeMultisigSignature({ vault, sessionId: session.id, pubkey: ALICE, signatureHex: SIG_A }),
            contributeMultisigSignature({ vault, sessionId: session.id, pubkey: BOB, signatureHex: SIG_B }),
        ]);
        const stored = records.get(session.id);
        expect(stored.signatures.map((s) => s.pubkey).sort()).toEqual([ALICE, BOB].sort());
        expect(stored.status).toBe('ready-to-finalize');
    });

    it('accepts one of two identical replies sent at once and refuses the other', async () => {
        const { vault, records } = slowVault();
        const session = await start(vault);
        const results = await Promise.allSettled([
            contributeMultisigSignature({ vault, sessionId: session.id, pubkey: ALICE, signatureHex: SIG_A }),
            contributeMultisigSignature({ vault, sessionId: session.id, pubkey: ALICE, signatureHex: SIG_A }),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(records.get(session.id).signatures).toHaveLength(1);
    });

    it('does not revive a session that was cancelled while a reply was being applied', async () => {
        const { vault, records } = slowVault();
        const session = await start(vault);
        await Promise.allSettled([
            contributeMultisigSignature({ vault, sessionId: session.id, pubkey: ALICE, signatureHex: SIG_A }),
            cancelMultisigSigningSession({ vault, sessionId: session.id }),
        ]);
        expect(records.get(session.id).status).toBe('cancelled');
    });

    it('broadcasts a finalized session once when Broadcast runs twice at once', async () => {
        const { vault, records } = slowVault();
        const session = await start(vault);
        // Real finalized bytes and the prevouts their PSBT records: the
        // broadcast verifies every signature before it sends.
        const finalized = signedTxFor({ inputs: [{ type: 'p2wsh-multisig' }] });
        records.set(session.id, { ...session, status: 'finalized', finalizedTxHex: finalized.txHex, txid: 'd1'.repeat(32) });
        const broadcastTx = vi.fn(async () => ({ txid: 'd1'.repeat(32) }));
        const sdkRegistry = {
            get: () => ({ encoder: { broadcastTx }, wallet: { decomposePsbt: () => ({ inputs: finalized.prevouts }) } }),
        };
        const results = await Promise.allSettled([
            finalizeMultisigSigningSession({ vault, sdkRegistry, sessionId: session.id, broadcast: true }),
            finalizeMultisigSigningSession({ vault, sdkRegistry, sessionId: session.id, broadcast: true }),
        ]);
        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
        expect(broadcastTx).toHaveBeenCalledTimes(1);
        expect(records.get(session.id).status).toBe('broadcast');
    });
});
