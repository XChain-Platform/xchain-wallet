// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Attach artwork upload review discloses a multi-part plan the way Gated
// publish does (UploadMethodReviewRows): the parts, the transactions and the
// whole upload's fee. A file over one transaction is held by reference
// (bytes null), so Attach Artwork also waits for the multi-part quote.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AttachContentForm } from '../../../packages/core/src/shared/routes/AttachContentForm.jsx';

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
const BYTES = new Uint8Array(400_000).fill(7);
const SOURCE = Object.freeze({
    id: 'addr-1', address: 'bc1qdevmock02aa', publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0", addressType: 'p2wpkh',
    source: 'hd', signerId: 'signer-1',
});

function holdQuotes() {
    quoteGate.held = true;
    quoteGate.waiting = new Promise((resolve) => { quoteGate.release = resolve; });
}

function clientFor() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 7 }),
        listPendingFileUploads: vi.fn().mockResolvedValue({ uploads: [] }),
        fileMultipart: vi.fn(),
    };
    return new Proxy(target, {
        get(value, property) {
            if (property in value) return value[property];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mount(client) {
    render(
        <MessagingProvider shell="web" messaging={client}>
            <AttachContentForm walletId="wallet-1" chainId={CHAIN} tick="ART" issuerAddress={SOURCE.address} onBack={() => {}} />
        </MessagingProvider>,
    );
}

async function pickByReference() {
    await screen.findByLabelText('Choose file to attach');
    await waitFor(() => expect(screen.getByLabelText('From address')).toHaveValue(SOURCE.address));
    const field = screen.getByLabelText(/^Artwork file \(up to /).closest('[data-file-field]');
    fireEvent.drop(field, {
        dataTransfer: { files: [new File([BYTES], 'art.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(screen.getByText(/^390\.\d KB$/)).toBeInTheDocument());
}

// The compose field's quoted Taproot fee line, as "Network fee about X BTC".
async function quotedTaprootFee() {
    const line = await waitFor(() => {
        const found = document.querySelector('[data-upload-fee="taproot"]');
        expect(found?.textContent).toMatch(/[\d.]+ BTC/);
        return found;
    });
    return line.textContent.match(/([\d.]+) BTC/)[1];
}

afterEach(() => {
    cleanup();
    quoteGate.release?.();
    quoteGate.held = false;
    quoteGate.release = null;
    quoteGate.waiting = null;
});

beforeEach(() => {
    quoteGate.held = false;
});

describe('Attach artwork review of a multi-part upload', () => {
    it('names the parts and transactions and reviews the whole upload fee', async () => {
        mount(clientFor());
        await pickByReference();
        await screen.findAllByText(/\d+ parts, \d+ transactions/);
        const fee = await quotedTaprootFee();
        const attach = screen.getByRole('button', { name: 'Attach Artwork' });
        await waitFor(() => expect(attach).toBeEnabled());
        fireEvent.click(attach);

        const form = await screen.findByRole('form', { name: 'Review artwork upload' });
        expect(within(form).getByTestId('review-upload-method'))
            .toHaveTextContent(/^Taproot upload, \d+ parts, \d+ transactions$/);
        expect(within(form).getByText('Estimated upload fee')).toBeInTheDocument();
        expect(within(form).getByTestId('review-upload-fee')).toHaveTextContent(`${fee} BTC`);
    });

    it('keeps Attach Artwork disabled until the multi-part quote resolves', async () => {
        holdQuotes();
        mount(clientFor());
        await pickByReference();
        await screen.findAllByText('Working out the parts and the fee.');
        const attach = screen.getByRole('button', { name: 'Attach Artwork' });
        expect(attach).toBeDisabled();
        fireEvent.click(attach);
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();

        quoteGate.release();
        await screen.findAllByText(/\d+ parts, \d+ transactions/);
        await waitFor(() => expect(attach).toBeEnabled());
        fireEvent.click(attach);
        const form = await screen.findByRole('form', { name: 'Review artwork upload' });
        expect(within(form).getByTestId('review-upload-method'))
            .toHaveTextContent(/^Taproot upload, \d+ parts, \d+ transactions$/);
        expect(within(form).getByTestId('review-upload-fee')).toHaveTextContent(/^[\d.]+ BTC$/);
    });
});
