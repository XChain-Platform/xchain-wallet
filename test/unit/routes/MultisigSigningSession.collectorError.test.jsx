// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

const {
    COLLECTOR_ERROR_MESSAGE,
    MultisigSigningSession,
} = await import('../../../packages/core/src/shared/routes/MultisigSigningSession.jsx');

const PK_A = `02${'11'.repeat(32)}`;
const PK_B = `02${'22'.repeat(32)}`;

function session() {
    return {
        schemaVersion: 1,
        id: 'session-1',
        walletId: 'wallet-1',
        chainId: 'bitcoin-mainnet',
        scheme: 'p2wsh-multisig',
        threshold: 2,
        cosignerPubkeys: [PK_A, PK_B],
        msgHash: 'aa'.repeat(32),
        psbtHex: '70736274ff',
        actionSummary: 'Send 0.01 BTC',
        nonces: [],
        partialSigs: [],
        signatures: [],
        status: 'collecting-sigs',
        createdAt: '2026-11-14T12:00:00.000Z',
        updatedAt: '2026-11-14T12:00:00.000Z',
    };
}

beforeEach(() => {
    const active = session();
    messaging = {
        listMultisigSigningSessions: vi.fn().mockResolvedValue([active]),
        getMultisigSigningSession: vi.fn().mockResolvedValue(active),
        contributeMultisigNonce: vi.fn(),
        contributeMultisigSignature: vi.fn(),
        aggregateMultisigSession: vi.fn(),
        cancelMultisigSigningSession: vi.fn(),
        finalizeMultisigSigningSession: vi.fn(),
        signMultisigLocally: vi.fn(),
    };
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('MultisigSigningSession collector errors', () => {
    it('shows a recovery step, logs the detail, and clears the sticky error', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<MultisigSigningSession walletId="wallet-1" onBack={() => {}} />);
        const list = await screen.findByRole('list', { name: 'Multisig sessions' });
        fireEvent.click(within(list).getByRole('button'));
        await screen.findByLabelText('Multisig signing progress');
        fireEvent.click(screen.getByRole('button', { name: /^Import cosigner reply/ }));
        fireEvent.change(screen.getByLabelText('Cosigner reply chunks'), {
            target: { value: 'XCW:1/1:00000000:AA==' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit Chunks' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(COLLECTOR_ERROR_MESSAGE);
        expect(screen.queryByText(/crc32 mismatch|xcw-qr|SHA256/i)).toBeNull();
        expect(consoleError).toHaveBeenCalledWith(
            'Multisig paste: reply frame rejected:',
            expect.stringMatching(/xcw-qr: crc32 mismatch/i),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Clear Received Reply' }));
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByLabelText('Cosigner reply chunks')).toHaveValue('');
    });
});
