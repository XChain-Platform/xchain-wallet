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
import {
    cancelMultisigSigningSession,
    contributeMultisigSignature,
    finalizeMultisigSigningSession,
    startMultisigSigningSession,
} from '../../../packages/core/src/flows/multisigSigning.js';

const ALICE = '02' + 'aa'.repeat(32);
const BOB = '03' + 'bb'.repeat(32);
const CAROL = '03' + 'cc'.repeat(32);
const SIG_A = '30' + 'aa'.repeat(35);
const SIG_B = '30' + 'bb'.repeat(35);

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
        msgHash: '11'.repeat(32),
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
        records.set(session.id, { ...session, status: 'finalized', finalizedTxHex: 'ab', txid: 'tx' });
        const broadcastTx = vi.fn(async () => ({ txid: 'tx' }));
        const sdkRegistry = { get: () => ({ encoder: { broadcastTx } }) };
        const results = await Promise.allSettled([
            finalizeMultisigSigningSession({ vault, sdkRegistry, sessionId: session.id, broadcast: true }),
            finalizeMultisigSigningSession({ vault, sdkRegistry, sessionId: session.id, broadcast: true }),
        ]);
        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
        expect(broadcastTx).toHaveBeenCalledTimes(1);
        expect(records.get(session.id).status).toBe('broadcast');
    });
});
