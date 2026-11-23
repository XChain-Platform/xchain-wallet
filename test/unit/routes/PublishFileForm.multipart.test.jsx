// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';
import { typeCustomRate } from '../../helpers/customNetworkFee.js';

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
    it('shows and clears each reserved-character field error before blocking review', async () => {
        const shell = messaging();
        mount(shell);
        const input = await screen.findByLabelText('File to publish');
        fireEvent.click(screen.getByRole('button', { name: 'Upload method: Taproot upload' }));
        fireEvent.click(screen.getAllByRole('option')[1]);
        fireEvent.change(input, {
            target: { files: [new File([new Uint8Array(20_000)], 'large|.bin', { type: 'application/octet-stream' })] },
        });
        expect(await screen.findByText("File name can't contain | or ;")).toBeInTheDocument();
        expect(screen.getByLabelText(/^File \(up to/)).toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByText("File name, title, and memo can't contain | or ; characters.")).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));
        expect(screen.queryByRole('button', { name: 'Sign and Publish' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));
        await waitFor(() => expect(screen.queryByText("File name can't contain | or ;")).toBeNull());
        fireEvent.change(input, {
            target: { files: [new File([new Uint8Array(20_000)], 'large.bin', { type: 'application/octet-stream' })] },
        });
        await waitFor(() => expect(screen.getByLabelText(/^File \(up to/)).toHaveValue('large.bin'));

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Quarterly | report' } });
        expect(screen.getByText("Title can't contain | or ;")).toBeInTheDocument();
        expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));
        expect(screen.queryByRole('button', { name: 'Sign and Publish' })).toBeNull();
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: '' } });
        await waitFor(() => expect(screen.queryByText("Title can't contain | or ;")).toBeNull());

        fireEvent.click(screen.getByRole('button', { name: /^Memo\b/, expanded: false }));
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'Quarterly | memo' } });
        expect(screen.getByText("Memo can't contain | or ;")).toBeInTheDocument();
        expect(screen.getByLabelText('Memo')).toHaveAttribute('aria-invalid', 'true');
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'Quarterly | memo still invalid' } });
        expect(screen.getByText("Memo can't contain | or ;")).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));
        expect(screen.queryByRole('button', { name: 'Sign and Publish' })).toBeNull();
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: '' } });

        await waitFor(() => expect(screen.queryByText("Memo can't contain | or ;")).toBeNull());
        expect(shell.fileMultipart).not.toHaveBeenCalled();
    });

    it('starts the selected lane and finishes on the manifest action index', async () => {
        const shell = messaging();
        mount(shell);
        const input = await screen.findByLabelText('File to publish');
        fireEvent.click(screen.getByRole('button', { name: 'Upload method: Taproot upload' }));
        fireEvent.click(screen.getAllByRole('option')[1]);
        expect(screen.getByRole('button', { name: 'Upload method: Standard' })).toBeEnabled();
        const bytes = new Uint8Array(20_000).fill(7);
        const file = new File([bytes], 'large.bin', { type: 'application/octet-stream' });
        fireEvent.change(input, {
            target: { files: [file] },
        });
        await waitFor(() => expect(document.body.textContent).toContain('large.bin'));
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));

        // Publish File opens the one approval (Decision Q6): nothing is sent
        // until Sign and Publish, and the review quotes the whole file.
        const approve = await screen.findByRole('button', { name: 'Sign and Publish' });
        expect(screen.getByTestId('review-upload-method')).toHaveTextContent(/Standard, \d+ parts, \d+ transactions/);
        expect(screen.getByTestId('review-upload-fee')).toHaveTextContent(/^[\d.]+ BTC$/);
        expect(shell.fileMultipart).not.toHaveBeenCalled();
        fireEvent.click(approve);

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
        // Typed into the one custom fee editor, the Network fee line (G113).
        ['', 'Enter a custom network fee.'],
        ['50000', 'Enter a rate no higher than 1,000 sat/vB.'],
    ])('refuses the custom fee %j before starting any publish path', async (rate, message) => {
        const shell = messaging();
        mount(shell);
        const input = await screen.findByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File(['abc'], 'small.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(document.body.textContent).toContain('small.txt'));
        fireEvent.click(await screen.findByRole('button', { name: /^Speed and Fees\b/, expanded: false }));
        await typeCustomRate(rate);
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));

        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(shell.fileMultipart).not.toHaveBeenCalled();
        expect(screen.queryByRole('heading', { name: 'Review publish' })).toBeNull();
    });
});
