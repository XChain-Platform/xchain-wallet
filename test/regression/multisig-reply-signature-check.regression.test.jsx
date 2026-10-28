// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: a cosigner reply counts only when its signature verifies.
//
//   [P1] 2026-10-27: A shape check alone lets two well-formed DER strings
//        under two listed cosigner keys, pasted while the explorer is
//        unreachable, move a 2-of-3 session to "Ready to finalize: 2 of 2"
//        and "Required signatures are collected"; the session then refuses
//        the real signatures as repeats.

import React from 'react';
import { secp256k1 } from '@noble/curves/secp256k1';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
    contributeMultisigSignature,
    startMultisigSigningSession,
} from '../../packages/core/src/flows/multisigSigning.js';
import {
    buildReplyEnvelope,
    encodeMultisigEnvelope,
    encodeXcwChunks,
    fingerprintSessionRef,
} from '../../packages/core/src/uri/index.js';

let messaging;

vi.mock('../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

const { MultisigSigningSession } = await import(
    '../../packages/core/src/shared/routes/MultisigSigningSession.jsx');

const MSG_HASH = 'c4'.repeat(32);
const key = (byte) => ({
    sk: byte.repeat(32),
    pub: Buffer.from(secp256k1.getPublicKey(byte.repeat(32), true)).toString('hex'),
});
const [A, B, C] = [key('1a'), key('2b'), key('3c')];
const sign = (k, msg = MSG_HASH) => secp256k1.sign(msg, k.sk, { lowS: true });
const N = secp256k1.CURVE.n;

function memoryVault() {
    const records = new Map();
    const wallet = {
        id: 'wallet-1',
        multisigs: [{
            id: 'config-1',
            scheme: 'p2wsh-multisig',
            threshold: 2,
            cosigners: [{ pubkey: A.pub }, { pubkey: B.pub }, { pubkey: C.pub }],
        }],
    };
    return {
        wallets: { get: async (id) => (id === wallet.id ? wallet : null) },
        multisigSigningSessions: {
            get: async (id) => structuredClone(records.get(id) || null),
            list: async () => [...records.values()].map((r) => structuredClone(r)),
            put: async (record) => { records.set(record.id, structuredClone(record)); },
        },
    };
}

async function start(vault) {
    return startMultisigSigningSession({
        vault, walletId: 'wallet-1', chainId: 'bitcoin-regtest', msgHash: MSG_HASH, psbtHex: '', actionSummary: 'Pay rent',
    });
}

afterEach(() => cleanup());

describe('classical cosigner replies are verified before they count', () => {
    it.each([
        ['well-formed DER that signs nothing', () => ({ pubkey: A.pub, sig: new secp256k1.Signature(12345n, 67890n).toDERHex() })],
        ['a real signature from another listed cosigner', () => ({ pubkey: A.pub, sig: sign(B).toDERHex() })],
        ['a signature of a different message', () => ({ pubkey: A.pub, sig: sign(A, 'd5'.repeat(32)).toDERHex() })],
        ['the high-S twin of a valid signature', () => {
            const s = sign(A);
            return { pubkey: A.pub, sig: new secp256k1.Signature(s.r, N - s.s).toDERHex() };
        }],
        ['a valid signature with a sighash byte appended', () => ({ pubkey: A.pub, sig: `${sign(A).toDERHex()}01` })],
    ])('refuses %s and leaves the session unchanged', async (_label, make) => {
        const vault = memoryVault();
        const session = await start(vault);
        const { pubkey, sig } = make();
        await expect(contributeMultisigSignature({ vault, sessionId: session.id, pubkey, signatureHex: sig }))
            .rejects.toMatchObject({ code: 'MULTISIG_SIGNATURE_INVALID' });
        const stored = await vault.multisigSigningSessions.get(session.id);
        expect(stored.signatures).toEqual([]);
        expect(stored.status).toBe('collecting-sigs');
    });

    it('counts valid signatures and still takes the real one after a refused reply', async () => {
        const vault = memoryVault();
        const session = await start(vault);
        await expect(contributeMultisigSignature({
            vault, sessionId: session.id, pubkey: A.pub, signatureHex: sign(B).toDERHex(),
        })).rejects.toMatchObject({ code: 'MULTISIG_SIGNATURE_INVALID' });
        await contributeMultisigSignature({ vault, sessionId: session.id, pubkey: A.pub, signatureHex: sign(A).toDERHex() });
        const done = await contributeMultisigSignature({
            vault, sessionId: session.id, pubkey: B.pub, signatureHex: sign(B).toDERHex().toUpperCase(),
        });
        expect(done.signatures.map((s) => s.pubkey)).toEqual([A.pub, B.pub]);
        expect(done.status).toBe('ready-to-finalize');
    });

    it('tells the user why a pasted reply is refused and offers no retry of the same reply', async () => {
        const vault = memoryVault();
        const session = await start(vault);
        messaging = {
            getSettings: vi.fn(async () => ({ walletMode: 'full' })),
            listMultisigSigningSessions: vi.fn(() => vault.multisigSigningSessions.list()),
            getMultisigSigningSession: vi.fn(({ sessionId }) => vault.multisigSigningSessions.get(sessionId)),
            contributeMultisigSignature: vi.fn((request) => contributeMultisigSignature({ ...request, vault })),
            cancelMultisigSigningSession: vi.fn(),
            signMultisigLocally: vi.fn(),
        };
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        const list = await screen.findByRole('list', { name: 'Multisig sessions' });
        fireEvent.click(within(list).getByRole('button'));
        await screen.findByLabelText('Multisig signing progress');
        fireEvent.click(screen.getByRole('button', { name: 'Import cosigner reply' }));
        const reply = buildReplyEnvelope({
            kind: 'multisig-classical-reply',
            fingerprint: fingerprintSessionRef({
                scheme: session.scheme,
                threshold: session.threshold,
                cosignerPubkeys: session.cosignerPubkeys,
                msgHash: session.msgHash,
                psbtHex: session.psbtHex,
            }),
            contribution: { pubkey: B.pub, sig: sign(C).toDERHex() },
        });
        fireEvent.change(screen.getByLabelText('Cosigner reply chunks'), {
            target: { value: encodeXcwChunks(encodeMultisigEnvelope(reply)).join('\n') },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit chunks' }));
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/signature doesn't match this signing session/);
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
        expect((await vault.multisigSigningSessions.get(session.id)).signatures).toEqual([]);
    });
});
