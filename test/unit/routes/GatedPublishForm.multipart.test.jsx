// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { GatedPublishForm } from '../../../packages/core/src/shared/routes/GatedPublishForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = {
    id: 'owner-1',
    address: 'bc1qgateownergateownergateownergateowner0',
    publicKey: `02${'22'.repeat(32)}`,
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function messaging() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getOwnedTokens: vi.fn().mockResolvedValue([{ tick: 'GATE' }]),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listGatedKeys: vi.fn().mockResolvedValue([]),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: OWNER.address, divisibility: 8 }),
        listPendingFileUploads: vi.fn().mockResolvedValue({ uploads: [] }),
        discardPendingFileUpload: vi.fn().mockResolvedValue({ paidTransactions: 0 }),
        fileMultipart: vi.fn().mockResolvedValue({
            fileId: '777',
            txid: 'ab'.repeat(32),
            multipart: { status: 'complete', total_parts: 3, total_bytes: 20_000 },
        }),
    };
}

function mount(shell) {
    render(
        <MessagingProvider shell="web" messaging={shell}>
            <GatedPublishForm
                walletId="wallet-1"
                chainId={CHAIN}
                tick="GATE"
                issuerAddress={OWNER.address}
                onBack={vi.fn()}
            />
        </MessagingProvider>,
    );
}

afterEach(cleanup);

describe('GatedPublishForm multipart review', () => {
    it('shows and clears each reserved-character field error before blocking review', async () => {
        const shell = messaging();
        mount(shell);
        const fileInput = await screen.findByLabelText(/^File \(up to/);
        fireEvent.click(screen.getByRole('button', { name: 'Upload method: Taproot upload' }));
        fireEvent.click(screen.getByRole('option', { name: (name) => name.startsWith('Standard') }));
        fireEvent.change(screen.getByLabelText('File to publish'), {
            target: { files: [new File([new Uint8Array(20_000)], 'members|.bin', { type: 'application/octet-stream' })] },
        });
        expect(await screen.findByText("File name can't contain | or ;")).toBeInTheDocument();
        expect(fileInput).toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByText("File name, title, and memo can't contain | or ; characters.")).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));
        expect(screen.queryByRole('button', { name: 'Sign and Publish' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));
        await waitFor(() => expect(screen.queryByText("File name can't contain | or ;")).toBeNull());
        fireEvent.change(screen.getByLabelText('File to publish'), {
            target: { files: [new File([new Uint8Array(20_000)], 'members.bin', { type: 'application/octet-stream' })] },
        });
        await waitFor(() => expect(fileInput).toHaveValue('members.bin'));

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Members | report' } });
        expect(screen.getByText("Title can't contain | or ;")).toBeInTheDocument();
        expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));
        expect(screen.queryByRole('button', { name: 'Sign and Publish' })).toBeNull();
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: '' } });
        await waitFor(() => expect(screen.queryByText("Title can't contain | or ;")).toBeNull());

        fireEvent.click(screen.getByRole('button', { name: /^Memo\b/, expanded: false }));
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'Members | only' } });
        expect(screen.getByText("Memo can't contain | or ;")).toBeInTheDocument();
        expect(screen.getByLabelText('Memo')).toHaveAttribute('aria-invalid', 'true');
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'Members | only still invalid' } });
        expect(screen.getByText("Memo can't contain | or ;")).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));
        expect(screen.queryByRole('button', { name: 'Sign and Publish' })).toBeNull();
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: '' } });

        await waitFor(() => expect(screen.queryByText("Memo can't contain | or ;")).toBeNull());
        expect(shell.fileMultipart).not.toHaveBeenCalled();
    });

    it('waits for one whole-file approval before starting the upload', async () => {
        const shell = messaging();
        mount(shell);
        const fileInput = await screen.findByLabelText(/^File \(up to/);
        fireEvent.click(screen.getByRole('button', { name: 'Upload method: Taproot upload' }));
        fireEvent.click(screen.getByRole('option', { name: (name) => name.startsWith('Standard') }));
        fireEvent.change(screen.getByLabelText('File to publish'), {
            target: { files: [new File([new Uint8Array(20_000)], 'members.bin', { type: 'application/octet-stream' })] },
        });
        await waitFor(() => expect(fileInput).toHaveValue('members.bin'));
        fireEvent.click(screen.getByRole('button', { name: 'Upload method: Standard' }));
        expect(await screen.findAllByText(/\d+ parts, \d+ transactions/)).not.toHaveLength(0);
        fireEvent.click(screen.getByRole('option', { name: (name) => name.startsWith('Standard') }));
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));

        await screen.findByRole('button', { name: 'Sign and Publish' });
        expect(shell.fileMultipart).not.toHaveBeenCalled();
        expect(screen.getByTestId('review-upload-method'))
            .toHaveTextContent(/Standard, \d+ parts, \d+ transactions/);
        expect(screen.getByTestId('review-upload-fee')).toHaveTextContent(/^[\d.]+ BTC$/);
        expect(screen.getByText('Token').nextElementSibling).toHaveTextContent('GATE');
        expect(screen.getByText('Unlock threshold').nextElementSibling).toHaveTextContent('1 GATE');
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByRole('button', { name: 'Publish File' })).toBeEnabled();
        expect(shell.fileMultipart).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Sign and Publish' }));

        await waitFor(() => expect(shell.fileMultipart).toHaveBeenCalledOnce());
    });
});
