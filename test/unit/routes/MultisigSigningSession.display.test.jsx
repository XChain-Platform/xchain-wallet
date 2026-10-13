// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
    buildReplyEnvelope,
    encodeMultisigEnvelope,
    encodeXcwChunks,
    fingerprintSessionRef,
} from '../../../packages/core/src/uri/index.js';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

const { MultisigSigningSession } = await import(
    '../../../packages/core/src/shared/routes/MultisigSigningSession.jsx');

const PK_A = `02${'11'.repeat(32)}`;
const PK_B = `02${'22'.repeat(32)}`;
const PK_C = `02${'33'.repeat(32)}`;
const NOW = '2026-10-13T12:00:00.000Z';

function session(overrides = {}) {
    return {
        schemaVersion: 1,
        id: 'session-1',
        walletId: 'wallet-1',
        chainId: 'bitcoin-mainnet',
        scheme: 'p2wsh-multisig',
        threshold: 2,
        cosignerPubkeys: [PK_A, PK_B, PK_C],
        msgHash: 'aa'.repeat(32),
        psbtHex: '70736274ff',
        actionSummary: 'Send 0.01 BTC',
        nonces: [],
        aggNonce: null,
        partialSigs: [],
        aggregatedSchnorrSig: null,
        signatures: [],
        status: 'collecting-sigs',
        finalizedTxHex: null,
        txid: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function signature(pubkey) {
    return { pubkey, sig: '30'.repeat(35), contributedAt: NOW };
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

async function mountAndOpen(activeSession) {
    messaging.listMultisigSigningSessions.mockResolvedValue([activeSession]);
    messaging.getMultisigSigningSession.mockResolvedValue(activeSession);
    const view = render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
    const sessionList = await screen.findByRole('list', { name: 'Multisig sessions' });
    fireEvent.click(within(sessionList).getByRole('button'));
    await screen.findByLabelText('Multisig signing progress');
    return view;
}

beforeEach(() => {
    messaging = {
        listMultisigSigningSessions: vi.fn(),
        getMultisigSigningSession: vi.fn(),
        contributeMultisigNonce: vi.fn().mockResolvedValue(undefined),
        contributeMultisigSignature: vi.fn().mockResolvedValue(undefined),
        aggregateMultisigSession: vi.fn().mockResolvedValue(undefined),
        cancelMultisigSigningSession: vi.fn().mockResolvedValue(undefined),
        finalizeMultisigSigningSession: vi.fn().mockResolvedValue(undefined),
        signMultisigLocally: vi.fn().mockResolvedValue(undefined),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('MultisigSigningSession contribution display', () => {
    it('identifies each signer and states how many signatures remain', async () => {
        await mountAndOpen(session({ signatures: [signature(PK_A)] }));

        expect(screen.getByLabelText('Signatures remaining')).toHaveTextContent(
            '1 more signature required.',
        );
        expect(within(screen.getByRole('list', { name: 'Signed cosigners' })).getByText(PK_A)).toBeTruthy();
        const pending = within(screen.getByRole('list', { name: 'Pending cosigners' }));
        expect(pending.getByText(PK_B)).toBeTruthy();
        expect(pending.getByText(PK_C)).toBeTruthy();
    });

    it('does not claim every cosigner signed when an n-of-m threshold is met', async () => {
        await mountAndOpen(session({
            status: 'ready-to-finalize',
            signatures: [signature(PK_A), signature(PK_B)],
        }));

        expect(screen.getByText('Required signatures collected.')).toBeTruthy();
        expect(screen.getByText(/must be finalized before it can be broadcast/i)).toBeTruthy();
        expect(within(screen.getByRole('list', { name: 'Cosigners who have not signed' }))
            .getByText(PK_C)).toBeTruthy();
        expect(screen.queryByText('All cosigners have contributed.')).toBeNull();
        expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
    });

    it('lists a cosigner once when persisted configuration contains a duplicate key', async () => {
        await mountAndOpen(session({
            cosignerPubkeys: [PK_A, PK_A, PK_B],
            signatures: [signature(PK_A)],
        }));

        const signed = within(screen.getByRole('list', { name: 'Signed cosigners' }));
        expect(signed.getAllByText(PK_A)).toHaveLength(1);
        expect(screen.getByLabelText('Signatures remaining')).toHaveTextContent(
            '1 more signature required.',
        );
        expect(within(screen.getByRole('list', { name: 'Pending cosigners' })).getByText(PK_B)).toBeTruthy();
    });
});

describe('MultisigSigningSession reply transport', () => {
    it('rejects a cosigner signature from a different session with clear copy', async () => {
        const activeSession = session({ signatures: [signature(PK_A)] });
        await mountAndOpen(activeSession);
        fireEvent.click(screen.getByRole('button', { name: 'Import cosigner reply' }));

        const otherRef = {
            scheme: activeSession.scheme,
            threshold: activeSession.threshold,
            cosignerPubkeys: activeSession.cosignerPubkeys,
            msgHash: 'bb'.repeat(32),
            psbtHex: activeSession.psbtHex,
        };
        const reply = buildReplyEnvelope({
            kind: 'multisig-classical-reply',
            fingerprint: fingerprintSessionRef(otherRef),
            contribution: { pubkey: PK_B, sig: '30'.repeat(35) },
        });
        const chunks = encodeXcwChunks(encodeMultisigEnvelope(reply));
        fireEvent.change(screen.getByLabelText('Cosigner reply chunks'), {
            target: { value: chunks.join('\n') },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit chunks' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This cosigner reply belongs to a different signing session.',
        );
        expect(messaging.contributeMultisigSignature).not.toHaveBeenCalled();
    });

    it('labels MuSig2 partial-signature export and import actions', async () => {
        await mountAndOpen(session({
            scheme: 'taproot-musig2',
            status: 'collecting-sigs',
            aggNonce: '44'.repeat(66),
            partialSigs: [signature(PK_A)],
        }));

        expect(screen.getByRole('button', { name: 'Export signing request' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Export signing request' }));
        expect(screen.getByLabelText('Signing data to copy').value).toMatch(/^XCW:/);
        fireEvent.click(screen.getByRole('button', { name: 'Back to tracker' }));
        fireEvent.click(screen.getByRole('button', { name: 'Import partial signature' }));
        expect(screen.getByText(/partial signature, checks that it belongs to this session and step/i)).toBeTruthy();
    });

    it('imports a partial signature only when it matches the active session', async () => {
        const activeSession = session({
            scheme: 'taproot-musig2',
            status: 'collecting-sigs',
            aggNonce: '44'.repeat(66),
        });
        await mountAndOpen(activeSession);
        fireEvent.click(screen.getByRole('button', { name: 'Import partial signature' }));

        const activeRef = {
            scheme: activeSession.scheme,
            threshold: activeSession.threshold,
            cosignerPubkeys: activeSession.cosignerPubkeys,
            msgHash: activeSession.msgHash,
            psbtHex: activeSession.psbtHex,
        };
        const partialSig = '55'.repeat(32);
        const reply = buildReplyEnvelope({
            kind: 'multisig-round-2-reply',
            fingerprint: fingerprintSessionRef(activeRef),
            contribution: { pubkey: PK_B, sig: partialSig },
        });
        const chunks = encodeXcwChunks(encodeMultisigEnvelope(reply));
        fireEvent.change(screen.getByLabelText('Cosigner reply chunks'), {
            target: { value: chunks.join('\n') },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit chunks' }));

        await waitFor(() => expect(messaging.contributeMultisigSignature).toHaveBeenCalledWith({
            sessionId: activeSession.id,
            pubkey: PK_B,
            signatureHex: partialSig,
        }));
        expect(await screen.findByText(/step 2 signature from .* accepted/i)).toBeTruthy();
    });
});

describe('MultisigSigningSession broadcast readiness', () => {
    it('keeps finalization disabled until distinct cosigners meet the threshold', async () => {
        await mountAndOpen(session({
            status: 'ready-to-finalize',
            signatures: [signature(PK_A), signature(PK_A)],
        }));

        expect(screen.getByLabelText('Multisig signing progress')).toHaveTextContent('1 of 2');
        expect(screen.getByLabelText('Signatures remaining')).toHaveTextContent(
            '1 more signature required.',
        );
        const finalize = screen.getByRole('button', { name: 'Finalize transaction' });
        expect(finalize).toBeDisabled();
        fireEvent.click(finalize);
        expect(messaging.finalizeMultisigSigningSession).not.toHaveBeenCalled();
    });

    it('does not refresh a finalized session after the tracker unmounts', async () => {
        const finalizeRequest = deferred();
        messaging.finalizeMultisigSigningSession.mockReturnValue(finalizeRequest.promise);
        const view = await mountAndOpen(session({
            status: 'ready-to-finalize',
            signatures: [signature(PK_A), signature(PK_B)],
        }));

        fireEvent.click(screen.getByRole('button', { name: 'Finalize transaction' }));
        expect(messaging.finalizeMultisigSigningSession).toHaveBeenCalledTimes(1);
        view.unmount();
        await act(async () => {
            finalizeRequest.resolve(undefined);
            await finalizeRequest.promise;
        });

        expect(messaging.getMultisigSigningSession).toHaveBeenCalledTimes(1);
        expect(messaging.listMultisigSigningSessions).toHaveBeenCalledTimes(1);
    });

    it('marks a finalized transaction ready and hides contribution actions', async () => {
        await mountAndOpen(session({
            status: 'finalized',
            signatures: [signature(PK_A), signature(PK_B)],
            finalizedTxHex: '00',
        }));

        expect(screen.getByText('This signed transaction is ready to broadcast.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Export signed transaction' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Sign with my key' })).toBeNull();
    });
});
