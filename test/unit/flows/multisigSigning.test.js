// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import {
    aggregateMultisigSession,
    contributeMultisigNonce,
    contributeMultisigSignature,
    finalizeMultisigSigningSession,
    startMultisigSigningSession,
} from '../../../packages/core/src/flows/multisigSigning.js';

const ALICE = '02' + 'aa'.repeat(32);
const BOB = '03' + 'bb'.repeat(32);

function storage(scheme = 'taproot-musig2') {
    const records = new Map();
    const wallet = {
        id: 'wallet-1',
        multisigs: [{
            id: 'config-1',
            scheme,
            threshold: 2,
            cosigners: [{ pubkey: ALICE }, { pubkey: BOB }],
        }],
    };
    const put = vi.fn(async (record) => records.set(record.id, record));
    return {
        records,
        put,
        vault: {
            wallets: { get: vi.fn(async (id) => id === wallet.id ? wallet : null) },
            multisigSigningSessions: {
                get: vi.fn(async (id) => records.get(id) || null),
                list: vi.fn(async () => [...records.values()]),
                put,
            },
        },
    };
}

async function start(vault, extra = {}) {
    return startMultisigSigningSession({
        vault,
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        msgHash: '11'.repeat(32),
        psbtHex: '70736274ff',
        ...extra,
    });
}

describe('multisig signing flow', () => {
    it('drives both MuSig2 rounds through the mocked SDK in cosigner order', async () => {
        const { vault } = storage();
        const session = await start(vault);
        await contributeMultisigNonce({
            vault, sessionId: session.id, pubkey: BOB, publicNonceHex: '22'.repeat(66),
        });
        await contributeMultisigNonce({
            vault, sessionId: session.id, pubkey: ALICE, publicNonceHex: '11'.repeat(66),
        });

        const aggregateNonces = vi.fn(() => new Uint8Array(66).fill(0xab));
        const startSession = vi.fn(() => ({ key: 'session-key' }));
        const aggregateSignatures = vi.fn(() => new Uint8Array(64).fill(0xcd));
        const sdkRegistry = {
            get: vi.fn(() => ({ musig2: { aggregateNonces, startSession, aggregateSignatures } })),
        };
        const roundTwo = await aggregateMultisigSession({
            vault, sdkRegistry, sessionId: session.id,
        });
        expect(roundTwo.status).toBe('collecting-sigs');
        expect(roundTwo.aggNonce).toBe('ab'.repeat(66));
        expect(aggregateNonces.mock.calls[0][0].map((value) => value[0])).toEqual([0x11, 0x22]);

        await contributeMultisigSignature({
            vault, sessionId: session.id, pubkey: BOB, signatureHex: '44'.repeat(32),
        });
        await contributeMultisigSignature({
            vault, sessionId: session.id, pubkey: ALICE, signatureHex: '33'.repeat(32),
        });
        const ready = await aggregateMultisigSession({ vault, sdkRegistry, sessionId: session.id });
        expect(ready.status).toBe('ready-to-finalize');
        expect(ready.aggregatedSchnorrSig).toBe('cd'.repeat(64));
        expect(aggregateSignatures.mock.calls[0][0].map((value) => value[0])).toEqual([0x33, 0x44]);
    });

    it('rejects odd-length ECDSA signature hex before writing storage', async () => {
        const { vault, put } = storage('p2wsh-multisig');
        const session = await start(vault);
        put.mockClear();

        await expect(contributeMultisigSignature({
            vault,
            sessionId: session.id,
            pubkey: ALICE,
            signatureHex: 'a'.repeat(17),
        })).rejects.toThrow('signatureHex must be hex');
        expect(put).not.toHaveBeenCalled();
    });

    it('rejects odd-length finalized transaction hex before writing storage', async () => {
        const { vault, records, put } = storage('p2wsh-multisig');
        const session = await start(vault);
        records.set(session.id, { ...session, status: 'ready-to-finalize' });
        put.mockClear();

        await expect(finalizeMultisigSigningSession({
            vault,
            sessionId: session.id,
            finalizedTxHex: 'abc',
        })).rejects.toThrow('finalizedTxHex must be hex');
        expect(put).not.toHaveBeenCalled();
    });
});
