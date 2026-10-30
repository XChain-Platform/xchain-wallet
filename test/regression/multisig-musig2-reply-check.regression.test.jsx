// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: a Taproot (MuSig2) cosigner reply counts only when it
// checks out against the session.
//
//   [P1] 2026-10-27: A 32-byte step 2 partial that signs nothing, pasted under
//        a listed cosigner, counts toward the 3-of-3 session; the combined
//        signature cannot spend and the cosigner's real partial is refused as a
//        repeat. The host route that takes the reply carries no SDK registry,
//        so the SDK's partial verifier never runs.
//   [P1] 2026-10-27: A step 1 reply whose nonce is not two curve points, or
//        that carries another cosigner's nonce, counts under a listed
//        cosigner; the combined nonce leaves no partial able to verify and
//        the cosigner's real reply is refused as a repeat.

import React from 'react';
import { createRequire } from 'node:module';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
    aggregateMultisigSession,
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
import { createBackgroundHost } from '../../packages/extension/src/background/createBackgroundHost.js';

const MuSig2 = createRequire(import.meta.url)('xchain-sdk/src/musig2.js');
const musig = new MuSig2();
const sdkRegistry = { get: () => ({ musig2: musig }), for: () => ({ musig2: musig }) };

let messaging;

vi.mock('../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

const { MultisigSigningSession } = await import(
    '../../packages/core/src/shared/routes/MultisigSigningSession.jsx');

const hex = (b) => Buffer.from(b).toString('hex');
const bytes = (h) => Uint8Array.from(Buffer.from(h, 'hex'));
const MSG_HASH = 'c4'.repeat(32);
const key = (byte) => {
    const sk = bytes(byte.repeat(32));
    return { sk, pk: secp256k1.getPublicKey(sk, true), pub: hex(secp256k1.getPublicKey(sk, true)) };
};
const [A, B, C] = [key('1a'), key('2b'), key('3c')];
const KEYS = [A, B, C];

function memoryVault() {
    const records = new Map();
    const wallet = {
        id: 'wallet-1',
        multisigs: [{
            id: 'config-1',
            scheme: 'taproot-musig2',
            threshold: 3,
            cosigners: KEYS.map((k) => ({ pubkey: k.pub })),
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

// A session at step 2 with every cosigner's real nonce, plus each cosigner's
// real partial over the session's aggregate nonce.
async function atStepTwo(vault) {
    const session = await startMultisigSigningSession({
        vault, walletId: 'wallet-1', chainId: 'bitcoin-regtest', msgHash: MSG_HASH, psbtHex: '', actionSummary: 'Pay rent',
    });
    const xOnlyPublicKey = musig.aggregateKeys(session.cosignerPubkeys.map(bytes)).xOnlyPubkey;
    const nonces = KEYS.map((k) => musig.generateNonce({ publicKey: k.pk, secretKey: k.sk, xOnlyPublicKey, msg: bytes(MSG_HASH) }));
    for (const [i, k] of KEYS.entries()) {
        await contributeMultisigNonce({ vault, sessionId: session.id, pubkey: k.pub, publicNonceHex: hex(nonces[i]) });
    }
    const stepTwo = await aggregateMultisigSession({ vault, sdkRegistry, sessionId: session.id });
    const sessionKey = musig.startSession(bytes(stepTwo.aggNonce), bytes(MSG_HASH), stepTwo.cosignerPubkeys.map(bytes));
    const partials = KEYS.map((k, i) => hex(musig.partialSign({ secretKey: k.sk, publicNonce: nonces[i], sessionKey })));
    return { session: stepTwo, partials, xOnlyPublicKey };
}

function sessionRefOf(session) {
    return {
        scheme: session.scheme,
        threshold: session.threshold,
        cosignerPubkeys: session.cosignerPubkeys,
        msgHash: session.msgHash,
        psbtHex: session.psbtHex,
    };
}

function makeHost(vault) {
    return createBackgroundHost({
        vault,
        chainRegistry: { get: () => null, list: () => [], supportedChains: () => [] },
        sdkRegistry,
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
}

afterEach(() => cleanup());

async function atStepOne(vault) {
    const session = await startMultisigSigningSession({
        vault, walletId: 'wallet-1', chainId: 'bitcoin-regtest', msgHash: MSG_HASH, psbtHex: '', actionSummary: 'Pay rent',
    });
    const xOnlyPublicKey = musig.aggregateKeys(session.cosignerPubkeys.map(bytes)).xOnlyPubkey;
    const nonces = KEYS.map((k) => hex(musig.generateNonce({ publicKey: k.pk, secretKey: k.sk, xOnlyPublicKey, msg: bytes(MSG_HASH) })));
    return { session, nonces };
}

// The first 33 bytes encode an x coordinate above the field prime.
const NOT_A_POINT = `02${'ff'.repeat(32)}`;

describe('MuSig2 step 1 replies are checked before they count', () => {
    it.each([
        ['a first half that is not a curve point', (nonces) => NOT_A_POINT + nonces[0].slice(66)],
        ['a second half that is not a curve point', (nonces) => nonces[0].slice(0, 66) + NOT_A_POINT],
        ['a prefix byte no compressed point uses', (nonces) => `04${nonces[0].slice(2)}`],
        ['the nonce cosigner B already sent', (nonces) => nonces[1]],
    ])('refuses %s under A through the host route and still takes the real reply', async (_label, make) => {
        const vault = memoryVault();
        const { session, nonces } = await atStepOne(vault);
        const host = makeHost(vault);
        await host.handle({
            type: 'multisigSign.contributeNonce',
            request: { sessionId: session.id, pubkey: B.pub, publicNonceHex: nonces[1] },
        });
        const refused = await host.handle({
            type: 'multisigSign.contributeNonce',
            request: { sessionId: session.id, pubkey: A.pub, publicNonceHex: make(nonces) },
        });
        expect(refused).toMatchObject({ ok: false, error: { code: 'MULTISIG_NONCE_INVALID' } });
        expect((await vault.multisigSigningSessions.get(session.id)).nonces.map((n) => n.pubkey)).toEqual([B.pub]);
        const accepted = await host.handle({
            type: 'multisigSign.contributeNonce',
            request: { sessionId: session.id, pubkey: A.pub, publicNonceHex: nonces[0].toUpperCase() },
        });
        expect(accepted.ok).toBe(true);
        expect(accepted.result.nonces.map((n) => n.pubkey)).toEqual([B.pub, A.pub]);
    });

    it('names a reply that repeats another cosigner\'s nonce apart from one that is not a nonce', async () => {
        const vault = memoryVault();
        const { session, nonces } = await atStepOne(vault);
        const host = makeHost(vault);
        const send = (pubkey, publicNonceHex) => host.handle({
            type: 'multisigSign.contributeNonce',
            request: { sessionId: session.id, pubkey, publicNonceHex },
        });
        await send(A.pub, nonces[0]);
        const repeated = await send(B.pub, nonces[0]);
        expect(repeated.error.message).toMatch(/identical to one already counted for another cosigner/);
        const malformed = await send(B.pub, NOT_A_POINT + nonces[1].slice(66));
        expect(malformed.error.message).toMatch(/isn't a valid response for this signing session/);
        expect((await send(B.pub, nonces[1])).ok).toBe(true);
    });

    it('tells the user why a pasted step 1 reply is refused and offers no retry of the same reply', async () => {
        const vault = memoryVault();
        const { session, nonces } = await atStepOne(vault);
        const host = makeHost(vault);
        messaging = {
            getSettings: vi.fn(async () => ({ walletMode: 'full' })),
            listMultisigSigningSessions: vi.fn(() => vault.multisigSigningSessions.list()),
            getMultisigSigningSession: vi.fn(({ sessionId }) => vault.multisigSigningSessions.get(sessionId)),
            contributeMultisigNonce: vi.fn(async (request) => {
                const r = await host.handle({ type: 'multisigSign.contributeNonce', request });
                if (r.ok) return r.result;
                throw Object.assign(new Error(r.error.message), { code: r.error.code });
            }),
            cancelMultisigSigningSession: vi.fn(),
            signMultisigLocally: vi.fn(),
        };
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        const list = await screen.findByRole('list', { name: 'Multisig sessions' });
        fireEvent.click(within(list).getByRole('button'));
        await screen.findByLabelText('Multisig signing progress');
        fireEvent.click(screen.getByRole('button', { name: 'Import cosigner reply' }));
        const reply = buildReplyEnvelope({
            kind: 'multisig-round-1-reply',
            fingerprint: fingerprintSessionRef(sessionRefOf(session)),
            contribution: { pubkey: C.pub, publicNonce: NOT_A_POINT + nonces[2].slice(66) },
        });
        fireEvent.change(screen.getByLabelText('Cosigner reply chunks'), {
            target: { value: encodeXcwChunks(encodeMultisigEnvelope(reply)).join('\n') },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit chunks' }));
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/step 1 reply isn't a valid response for this signing session/);
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
        expect((await vault.multisigSigningSessions.get(session.id)).nonces).toEqual([]);
    });
});

describe('MuSig2 step 2 partials are verified before they count', () => {
    it.each([
        ['32 bytes that sign nothing', () => '5e'.repeat(32)],
        ['another cosigner\'s real partial', (partials) => partials[1]],
        ['a value at or above the curve order', () => 'ff'.repeat(32)],
    ])('refuses %s under A through the host route and leaves the slot open', async (_label, make) => {
        const vault = memoryVault();
        const { session, partials } = await atStepTwo(vault);
        const host = makeHost(vault);
        const refused = await host.handle({
            type: 'multisigSign.contributeSignature',
            request: { sessionId: session.id, pubkey: A.pub, signatureHex: make(partials) },
        });
        expect(refused).toMatchObject({ ok: false, error: { code: 'MULTISIG_SIGNATURE_INVALID' } });
        expect((await vault.multisigSigningSessions.get(session.id)).partialSigs).toEqual([]);
        const accepted = await host.handle({
            type: 'multisigSign.contributeSignature',
            request: { sessionId: session.id, pubkey: A.pub, signatureHex: partials[0] },
        });
        expect(accepted.ok).toBe(true);
        expect(accepted.result.partialSigs.map((s) => s.pubkey)).toEqual([A.pub]);
    });

    it('counts real partials and combines them into a signature that verifies under the aggregate key', async () => {
        const vault = memoryVault();
        const { session, partials, xOnlyPublicKey } = await atStepTwo(vault);
        for (const [i, k] of KEYS.entries()) {
            await contributeMultisigSignature({ vault, sdkRegistry, sessionId: session.id, pubkey: k.pub, signatureHex: partials[i] });
        }
        const done = await aggregateMultisigSession({ vault, sdkRegistry, sessionId: session.id });
        expect(done.status).toBe('ready-to-finalize');
        expect(schnorr.verify(bytes(done.aggregatedSchnorrSig), bytes(MSG_HASH), xOnlyPublicKey)).toBe(true);
    });

    it('refuses to count a partial when no SDK registry is supplied', async () => {
        const vault = memoryVault();
        const { session, partials } = await atStepTwo(vault);
        await expect(contributeMultisigSignature({ vault, sessionId: session.id, pubkey: A.pub, signatureHex: partials[0] }))
            .rejects.toThrow(/sdkRegistry is required/);
        expect((await vault.multisigSigningSessions.get(session.id)).partialSigs).toEqual([]);
    });

    it('tells the user why a pasted partial is refused and offers no retry of the same reply', async () => {
        const vault = memoryVault();
        const { session } = await atStepTwo(vault);
        const host = makeHost(vault);
        const viaHost = (type) => vi.fn(async (request) => {
            const r = await host.handle({ type, request });
            if (r.ok) return r.result;
            throw Object.assign(new Error(r.error.message), { code: r.error.code });
        });
        messaging = {
            getSettings: vi.fn(async () => ({ walletMode: 'full' })),
            listMultisigSigningSessions: vi.fn(() => vault.multisigSigningSessions.list()),
            getMultisigSigningSession: vi.fn(({ sessionId }) => vault.multisigSigningSessions.get(sessionId)),
            contributeMultisigSignature: viaHost('multisigSign.contributeSignature'),
            cancelMultisigSigningSession: vi.fn(),
            signMultisigLocally: vi.fn(),
        };
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        const list = await screen.findByRole('list', { name: 'Multisig sessions' });
        fireEvent.click(within(list).getByRole('button'));
        await screen.findByLabelText('Multisig signing progress');
        fireEvent.click(screen.getByRole('button', { name: 'Import partial signature' }));
        const reply = buildReplyEnvelope({
            kind: 'multisig-round-2-reply',
            fingerprint: fingerprintSessionRef(sessionRefOf(session)),
            contribution: { pubkey: B.pub, sig: '5e'.repeat(32) },
        });
        fireEvent.change(screen.getByLabelText('Cosigner reply chunks'), {
            target: { value: encodeXcwChunks(encodeMultisigEnvelope(reply)).join('\n') },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit chunks' }));
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/signature doesn't match this signing session/);
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
        expect((await vault.multisigSigningSessions.get(session.id)).partialSigs).toEqual([]);
    });
});
