// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const TXID = 'ab'.repeat(32);
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qpublishpublishpublishpublishpublishpub',
    publicKey: `02${'ab'.repeat(32)}`,
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
    addressType: 'p2wpkh',
});

function messaging(overrides = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listPendingFileUploads: vi.fn().mockResolvedValue({ uploads: [] }),
        discardPendingFileUpload: vi.fn().mockResolvedValue({ paidTransactions: 0 }),
        fileMultipart: vi.fn().mockResolvedValue({
            fileId: '777',
            txid: TXID,
            multipart: { status: 'complete', total_parts: 2, total_bytes: 10_000 },
        }),
        ...overrides,
    };
}

function mount(shell) {
    return render(
        <MessagingProvider shell="web" messaging={shell}>
            <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
        </MessagingProvider>,
    );
}

afterEach(cleanup);

describe('PublishFileForm multipart publish', () => {
    it('starts the selected lane and finishes on the manifest action index', async () => {
        const shell = messaging();
        mount(shell);
        const input = await screen.findByLabelText('File (up to 262,140,000,000 bytes)');
        fireEvent.click(screen.getByRole('button', { name: 'Upload method: Taproot upload' }));
        fireEvent.click(screen.getAllByRole('option')[1]);
        expect(screen.getByRole('button', { name: 'Upload method: Standard' })).toBeEnabled();
        const bytes = new Uint8Array(20_000).fill(7);
        const file = new File([bytes], 'large.bin', { type: 'application/octet-stream' });
        fireEvent.change(input, {
            target: { files: [file] },
        });
        await waitFor(() => expect(document.body.textContent).toContain('20,000 bytes'));
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Publish file' }));

        await waitFor(() => expect(shell.fileMultipart).toHaveBeenCalledOnce());
        expect(shell.fileMultipart).toHaveBeenCalledWith(expect.objectContaining({
            walletId: 'wallet-1',
            chainId: CHAIN,
            sourceAddress: ADDRESS.address,
            lane: 'standard',
            buildMode: 'one_call',
            meta: expect.objectContaining({ name: 'large.bin', type: 'application/octet-stream' }),
            fileRef: { kind: 'inline', blob: file },
        }));
        expect(shell.fileMultipart.mock.calls[0][0]).not.toHaveProperty('rawData');
        expect(await screen.findByRole('heading', { name: 'File published' })).toBeInTheDocument();
        expect(screen.getByText('Action index').nextElementSibling).toHaveTextContent('777');
        expect(screen.getByText('Transaction').nextElementSibling).toHaveTextContent(TXID);
    });
});

describe('PublishFileForm multipart panel', () => {
    it('renders unfinished uploads and the hidden continuation picker', async () => {
        const shell = messaging({
            listPendingFileUploads: vi.fn().mockResolvedValue({
                uploads: [{
                    id: 'upload-1',
                    walletId: 'wallet-1',
                    chainId: CHAIN,
                    sourceAddress: ADDRESS.address,
                    originalSha256: 'cd'.repeat(32),
                    name: 'unfinished.bin',
                    stage: 'sending',
                    partsSent: 1,
                    totalParts: 2,
                    paidTransactions: 3,
                }],
            }),
        });
        mount(shell);

        expect(await screen.findByRole('heading', { name: 'Unfinished uploads' })).toBeInTheDocument();
        expect(screen.getByLabelText('unfinished.bin')).toHaveTextContent('1 of 2 parts uploaded');
        expect(screen.getByLabelText('Choose the file to resume')).toHaveAttribute('type', 'file');
        expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Discard (3 transactions already paid)' })).toBeEnabled();
    });
});

describe('PublishFileForm fee validation with multipart available', () => {
    it.each([
        ['', 'Enter a custom fee rate.'],
        ['1.123456789', 'Custom fee rate can have at most 8 decimal places.'],
        ['999999999999999999999', 'Enter a rate no higher than 1,000 sat/vB.'],
    ])('refuses the custom fee %j before starting any publish path', async (rate, message) => {
        const shell = messaging();
        mount(shell);
        const input = await screen.findByLabelText('File (up to 262,140,000,000 bytes)');
        fireEvent.change(input, {
            target: { files: [new File(['abc'], 'small.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(document.body.textContent).toContain('small.txt'));
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), {
            target: { value: '3' },
        });
        fireEvent.change(screen.getByLabelText('Custom fee rate (sat/vB)'), {
            target: { value: rate },
        });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Publish file' }));

        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(shell.fileMultipart).not.toHaveBeenCalled();
        expect(screen.queryByRole('heading', { name: 'Review publish' })).toBeNull();
    });
});
