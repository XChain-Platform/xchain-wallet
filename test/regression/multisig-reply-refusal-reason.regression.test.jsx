// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: cosigner replies the session cannot take.
//
//   [P2] 2026-10-24: A reply signed by a key outside the multisig, or a
//        second reply from a cosigner who already contributed, reaches the
//        host, which refuses it with a developer message. The screen shows
//        "Failed to apply contribution." with a Try again button that
//        resubmits the same refused reply, and never says why.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const PK_A = `02${'11'.repeat(32)}`;
const PK_B = `02${'22'.repeat(32)}`;
const PK_C = `02${'33'.repeat(32)}`;
const OUTSIDER = `03${'44'.repeat(32)}`;
const NOW = '2026-10-24T12:00:00.000Z';
const DER = `3044${'0220'}${'11'.repeat(32)}${'0220'}${'22'.repeat(32)}`;

function session(overrides = {}) {
    return {
        schemaVersion: 1,
        id: 'session-1',
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
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

function replyChunks(active, pubkey) {
    const fingerprint = fingerprintSessionRef({
        scheme: active.scheme,
        threshold: active.threshold,
        cosignerPubkeys: active.cosignerPubkeys,
        msgHash: active.msgHash,
        psbtHex: active.psbtHex,
    });
    const envelope = buildReplyEnvelope({
        kind: 'multisig-classical-reply',
        fingerprint,
        contribution: { pubkey, sig: DER },
    });
    return encodeXcwChunks(encodeMultisigEnvelope(envelope)).join('\n');
}

async function importReply(active, pubkey) {
    messaging.listMultisigSigningSessions.mockResolvedValue([active]);
    messaging.getMultisigSigningSession.mockResolvedValue(active);
    render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
    const list = await screen.findByRole('list', { name: 'Multisig sessions' });
    fireEvent.click(within(list).getByRole('button'));
    await screen.findByLabelText('Multisig signing progress');
    fireEvent.click(screen.getByRole('button', { name: 'Import cosigner reply' }));
    fireEvent.change(screen.getByLabelText('Cosigner reply chunks'), {
        target: { value: replyChunks(active, pubkey) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit chunks' }));
}

beforeEach(() => {
    messaging = {
        listMultisigSigningSessions: vi.fn(),
        getMultisigSigningSession: vi.fn(),
        contributeMultisigNonce: vi.fn().mockResolvedValue(undefined),
        contributeMultisigSignature: vi.fn().mockRejectedValue(
            new Error('multisigSigning: refused by the host'),
        ),
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

describe('regression/multisig-reply-refusal-reason', () => {
    it('[REGRESSION P2] names a reply signed by a key outside the multisig', async () => {
        await importReply(session(), OUTSIDER);

        expect(await screen.findByText(/signed by a key that is not one of this multisig's cosigners/i)).toBeTruthy();
        expect(messaging.contributeMultisigSignature).not.toHaveBeenCalled();
        expect(screen.queryByText('Failed to apply contribution.')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('[REGRESSION P2] names a second reply from a cosigner who already signed', async () => {
        await importReply(session({
            signatures: [{ pubkey: PK_A, sig: DER, contributedAt: NOW }],
        }), PK_A);

        expect(await screen.findByText(/reply is already applied to this step/i)).toBeTruthy();
        expect(messaging.contributeMultisigSignature).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('[REGRESSION P2] still applies a reply from a pending cosigner', async () => {
        messaging.contributeMultisigSignature.mockResolvedValue(undefined);
        await importReply(session({
            signatures: [{ pubkey: PK_A, sig: DER, contributedAt: NOW }],
        }), PK_B);

        await waitFor(() => expect(messaging.contributeMultisigSignature).toHaveBeenCalledWith({
            sessionId: 'session-1',
            pubkey: PK_B,
            signatureHex: DER,
        }));
    });
});
