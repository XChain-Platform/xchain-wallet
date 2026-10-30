// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: the surface that loses a race on one cosigner reply.
//
//   [P2] 2026-10-27: The same cosigner reply submitted on the popup and the
//        side panel at once lands once; the losing surface shows "Failed to
//        apply contribution" with a Try again that repeats the same refusal,
//        and its progress still reads 0 of 3 while the session holds 1.

import React from 'react';
import { secp256k1 } from '@noble/curves/secp256k1';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
    contributeMultisigNonce,
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
const hex = (b) => Buffer.from(b).toString('hex');
const key = (byte) => ({ sk: byte.repeat(32), pub: hex(secp256k1.getPublicKey(byte.repeat(32), true)) });
const [A, B, C] = [key('1a'), key('2b'), key('3c')];
const NONCE_A = hex(secp256k1.getPublicKey('4d'.repeat(32), true)) + hex(secp256k1.getPublicKey('5e'.repeat(32), true));

function memoryVault(scheme) {
    const records = new Map();
    const wallet = {
        id: 'wallet-1',
        multisigs: [{
            id: 'config-1',
            scheme,
            threshold: scheme === 'taproot-musig2' ? 3 : 2,
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

const CASES = {
    'a Taproot step 1 reply': {
        scheme: 'taproot-musig2',
        kind: 'multisig-round-1-reply',
        contribution: { pubkey: A.pub, publicNonce: NONCE_A },
        apply: (vault, sessionId) => contributeMultisigNonce({ vault, sessionId, pubkey: A.pub, publicNonceHex: NONCE_A }),
        stored: (s) => s.nonces,
    },
    'a SegWit cosigner signature': {
        scheme: 'p2wsh-multisig',
        kind: 'multisig-classical-reply',
        contribution: { pubkey: A.pub, sig: secp256k1.sign(MSG_HASH, A.sk, { lowS: true }).toDERHex() },
        apply: (vault, sessionId) => contributeMultisigSignature({
            vault, sessionId, pubkey: A.pub, signatureHex: secp256k1.sign(MSG_HASH, A.sk, { lowS: true }).toDERHex(),
        }),
        stored: (s) => s.signatures,
    },
};

afterEach(() => cleanup());

describe('the surface that loses a race on one reply reloads the session', () => {
    it.each(Object.keys(CASES))('shows %s as already applied, with progress and no retry', async (name) => {
        const c = CASES[name];
        const vault = memoryVault(c.scheme);
        const session = await startMultisigSigningSession({
            vault, walletId: 'wallet-1', chainId: 'bitcoin-regtest', msgHash: MSG_HASH, psbtHex: '', actionSummary: 'Pay rent',
        });
        // The other surface applies the same reply first; this surface's
        // submission then meets the host's repeat refusal.
        const contribute = vi.fn(async () => {
            await c.apply(vault, session.id);
            await c.apply(vault, session.id);
        });
        messaging = {
            getSettings: vi.fn(async () => ({ walletMode: 'full' })),
            listMultisigSigningSessions: vi.fn(() => vault.multisigSigningSessions.list()),
            getMultisigSigningSession: vi.fn(({ sessionId }) => vault.multisigSigningSessions.get(sessionId)),
            contributeMultisigNonce: contribute,
            contributeMultisigSignature: contribute,
            cancelMultisigSigningSession: vi.fn(),
            signMultisigLocally: vi.fn(),
        };
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        const list = await screen.findByRole('list', { name: 'Multisig sessions' });
        fireEvent.click(within(list).getByRole('button'));
        await screen.findByLabelText('Multisig signing progress');
        fireEvent.click(screen.getByRole('button', { name: 'Import cosigner reply' }));
        const reply = buildReplyEnvelope({
            kind: c.kind,
            fingerprint: fingerprintSessionRef({
                scheme: session.scheme,
                threshold: session.threshold,
                cosignerPubkeys: session.cosignerPubkeys,
                msgHash: session.msgHash,
                psbtHex: session.psbtHex,
            }),
            contribution: c.contribution,
        });
        fireEvent.change(screen.getByLabelText('Cosigner reply chunks'), {
            target: { value: encodeXcwChunks(encodeMultisigEnvelope(reply)).join('\n') },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit chunks' }));
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/already applied to this step/);
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
        expect(c.stored(await vault.multisigSigningSessions.get(session.id)).map((x) => x.pubkey)).toEqual([A.pub]);
        fireEvent.click(screen.getByRole('button', { name: 'Back to tracker' }));
        expect((await screen.findByLabelText('Multisig signing progress')).textContent).toMatch(/1 of /);
    });
});
