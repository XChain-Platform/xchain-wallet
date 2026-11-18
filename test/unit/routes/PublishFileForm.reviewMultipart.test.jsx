// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Publish File never opens a multi-part review before the quote resolves, so
// the review always names the parts, the transactions and the whole fee.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';

// Each quote waits on a gate the test opens, so the pending window is real.
const quoteGate = vi.hoisted(() => ({ held: false, release: null, waiting: null }));

vi.mock('../../../packages/core/src/flows/multipartQuotePreview.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        previewMultipartQuotes: vi.fn(async (args) => {
            if (quoteGate.held) await quoteGate.waiting;
            return actual.previewMultipartQuotes(args);
        }),
    };
});

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qpublishpublishpublishpublishpublishpub',
    publicKey: `02${'ab'.repeat(32)}`,
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
    addressType: 'p2wpkh',
});

function messaging() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listPendingFileUploads: vi.fn().mockResolvedValue({ uploads: [] }),
        discardPendingFileUpload: vi.fn().mockResolvedValue({ paidTransactions: 0 }),
        fileMultipart: vi.fn(),
    };
}

afterEach(() => {
    cleanup();
    quoteGate.release?.();
    quoteGate.held = false;
    quoteGate.release = null;
    quoteGate.waiting = null;
});

describe('PublishFileForm multi-part review', () => {
    it('keeps Publish File disabled until the multi-part quote resolves', async () => {
        quoteGate.held = true;
        quoteGate.waiting = new Promise((resolve) => { quoteGate.release = resolve; });
        render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );
        const input = await screen.findByLabelText('File to publish');
        fireEvent.click(screen.getByRole('button', { name: 'Upload method: Taproot upload' }));
        fireEvent.click(screen.getAllByRole('option')[1]);
        const file = new File([new Uint8Array(20_000).fill(7)], 'large.bin', { type: 'application/octet-stream' });
        fireEvent.change(input, { target: { files: [file] } });
        await waitFor(() => expect(document.body.textContent).toContain('large.bin'));
        await screen.findAllByText('Working out the parts and the fee.');

        const publish = screen.getByRole('button', { name: 'Publish File' });
        expect(publish).toBeDisabled();
        fireEvent.click(publish);
        expect(screen.queryByRole('button', { name: 'Sign and Publish' })).toBeNull();

        quoteGate.release();
        await screen.findAllByText(/\d+ parts, \d+ transactions/);
        await waitFor(() => expect(publish).toBeEnabled());
        fireEvent.click(publish);
        await screen.findByRole('button', { name: 'Sign and Publish' });
        expect(screen.getByTestId('review-upload-method')).toHaveTextContent(/^Standard, \d+ parts, \d+ transactions$/);
        expect(screen.getByTestId('review-upload-fee')).toHaveTextContent(/^[\d.]+ BTC$/);
    });
});
