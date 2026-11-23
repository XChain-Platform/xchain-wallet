// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AttachContentForm } from '../../../packages/core/src/shared/routes/AttachContentForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const TXID = 'ab'.repeat(32);
const BYTES = new Uint8Array(400_000).fill(7);
const SOURCE = Object.freeze({
    id: 'addr-1', address: 'bc1qdevmock02aa', publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0", addressType: 'p2wpkh',
    source: 'hd', signerId: 'signer-1',
});

let OriginalFileReader;

class MultipartFileReader {
    readAsArrayBuffer() {
        this.result = BYTES.slice().buffer;
        queueMicrotask(() => this.onload?.());
    }
}

function completeDetail(actionIndex = 71) {
    return {
        action: 'FILE', action_index: actionIndex, action_format: 1, status: 'valid',
        multipart: {
            file_hash: 'cd'.repeat(32), total_parts: 2, parts_received: 2,
            total_bytes: BYTES.length, status: 'complete',
        },
    };
}

function uploadReply(issueActionIndex = '7') {
    return {
        txid: TXID, fileId: '999', multipart: completeDetail().multipart,
        upload: { linkTarget: { tick: 'ART', issueActionIndex } },
    };
}

function clientFor(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 7 }),
        listPendingFileUploads: vi.fn().mockResolvedValue({ uploads: [] }),
        discardPendingFileUpload: vi.fn().mockResolvedValue({ removed: true }),
        fileMultipart: vi.fn().mockResolvedValue(uploadReply()),
        getActionByTxid: vi.fn().mockResolvedValue({
            actions: [{ action: 'FILE', action_index: 71 }],
        }),
        getActionByIndex: vi.fn().mockResolvedValue(completeDetail()),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', version: 1, chainId: CHAIN,
            actionString: 'LINK|0|BTC|71|BTC|7|',
            decoded: { summary: 'Link artwork', details: [], warnings: [] },
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        linkAction: vi.fn().mockResolvedValue({ txid: 'link-tx' }),
        ...overrides,
    };
    return new Proxy(target, {
        get(value, property) {
            if (property in value) return value[property];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mount(client, sourceAddress = SOURCE.address) {
    render(
        <MessagingProvider shell="web" messaging={client}>
            <AttachContentForm walletId="wallet-1" chainId={CHAIN} tick="ART" issuerAddress={sourceAddress} onBack={() => {}} />
        </MessagingProvider>,
    );
}

// The artwork file field: its label carries the live ceiling.
function artworkField() {
    return screen.getByLabelText(/^Artwork file \(up to /).closest('[data-file-field]');
}

async function pickMultipartFile() {
    await screen.findByLabelText('Choose file to attach');
    await waitFor(() => expect(screen.getByLabelText('From address')).toHaveValue(SOURCE.address));
    fireEvent.drop(artworkField(), {
        dataTransfer: { files: [new File([BYTES], 'art.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => expect(screen.getByText(/^390\.\d KB$/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Attach Artwork' })).toBeEnabled());
}

async function openMultipartLink(client) {
    await pickMultipartFile();
    // The multi-part lane lifts the field's ceiling into megabytes.
    expect(screen.getByLabelText(/^Artwork file \(up to [\d.,]+ MB\)$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Attach Artwork' }));
    await screen.findByRole('form', { name: 'Review artwork upload' });
    fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));
    await screen.findByRole('form', { name: 'Review artwork link' });
    expect(client.getActionByTxid).toHaveBeenCalledWith({ chainId: CHAIN, txid: TXID });
    expect(client.getActionByIndex).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '71' });
}

beforeEach(() => {
    OriginalFileReader = globalThis.FileReader;
    globalThis.FileReader = MultipartFileReader;
});

afterEach(() => {
    cleanup();
    globalThis.FileReader = OriginalFileReader;
});

describe('new multipart artwork upload', () => {
    it('shows and clears each reserved-character field error before blocking review', async () => {
        const client = clientFor();
        mount(client);
        await screen.findByLabelText('Choose file to attach');
        await waitFor(() => expect(screen.getByLabelText('From address')).toHaveValue(SOURCE.address));
        fireEvent.drop(artworkField(), {
            dataTransfer: { files: [new File([BYTES], 'art|.txt', { type: 'text/plain' })] },
        });
        expect(await screen.findByText("File name can't contain | or ;")).toBeInTheDocument();
        expect(screen.getByLabelText(/^Artwork file \(up to /)).toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByText('File name, title, and memo cannot contain | or ; characters.')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Attach Artwork' }));
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));
        await waitFor(() => expect(screen.queryByText("File name can't contain | or ;")).toBeNull());
        fireEvent.drop(artworkField(), {
            dataTransfer: { files: [new File([BYTES], 'art.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(screen.getByLabelText(/^Artwork file \(up to /)).toHaveValue('art.txt'));

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Token | artwork' } });
        expect(screen.getByText("Title can't contain | or ;")).toBeInTheDocument();
        expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Attach Artwork' }));
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: '' } });
        await waitFor(() => expect(screen.queryByText("Title can't contain | or ;")).toBeNull());

        fireEvent.click(screen.getByRole('button', { name: /^Memo\b/, expanded: false }));
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'Token | memo' } });
        expect(screen.getByText("Memo can't contain | or ;")).toBeInTheDocument();
        expect(screen.getByLabelText('Memo')).toHaveAttribute('aria-invalid', 'true');
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'Token | memo still invalid' } });
        expect(screen.getByText("Memo can't contain | or ;")).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Attach Artwork' }));
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: '' } });

        await waitFor(() => expect(screen.queryByText("Memo can't contain | or ;")).toBeNull());
        expect(client.fileMultipart).not.toHaveBeenCalled();
    });

    it('retains the link target and uses the complete manifest index for LINK', async () => {
        const client = clientFor();
        mount(client);
        await openMultipartLink(client);

        expect(client.fileMultipart).toHaveBeenCalledWith(expect.objectContaining({
            walletId: 'wallet-1', chainId: CHAIN, lane: 'envelope',
            linkTarget: { tick: 'ART', issueActionIndex: '7' },
        }));
        expect(screen.getByText('Artwork file record').nextElementSibling).toHaveTextContent('BTC#71');
        fireEvent.click(screen.getByRole('button', { name: 'Link Artwork to ART' }));
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        expect(client.composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            actionData: { action: 'LINK', params: expect.objectContaining({ COIN1_ACTION_INDEX: '71' }) },
        }));
    });
});

describe('resumed multipart artwork upload', () => {
    it('rechecks completion and restores the retained token target', async () => {
        const originalSha256 = createHash('sha256').update(BYTES).digest('hex');
        const entry = {
            id: 'upload-1', name: 'art.txt', chainId: CHAIN,
            sourceAddress: SOURCE.address, originalSha256, createdAt: '2026-11-16T08:00:00.000Z',
            linkTarget: { tick: 'ART', issueActionIndex: '43' }, gated: false,
            partsSent: 1, totalParts: 2, paidTransactions: 3, stage: 'sending',
        };
        const client = clientFor({
            listPendingFileUploads: vi.fn().mockResolvedValue({ uploads: [entry] }),
            fileMultipart: vi.fn().mockResolvedValue(uploadReply('43')),
        });
        mount(client);
        await screen.findByRole('heading', { name: 'Unfinished uploads' });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        fireEvent.change(screen.getByLabelText('Choose the file to resume'), {
            target: { files: [new File([BYTES], 'art.txt', { type: 'text/plain' })] },
        });

        await screen.findByRole('form', { name: 'Review artwork link' });
        expect(client.fileMultipart).toHaveBeenCalledWith(expect.objectContaining({ resumeId: 'upload-1' }));
        expect(client.getActionByIndex).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '71' });
        expect(screen.getByText('Artwork file record').nextElementSibling).toHaveTextContent('BTC#71');
        expect(screen.getByText('Token creation record').nextElementSibling).toHaveTextContent('BTC#43');
    });
});

describe('incomplete multipart artwork manifest', () => {
    it('does not open LINK review from the upload reply alone', async () => {
        const pending = completeDetail();
        pending.multipart = { ...pending.multipart, parts_received: 1, status: 'pending' };
        const client = clientFor({ getActionByIndex: vi.fn().mockResolvedValue(pending) });
        mount(client);
        await pickMultipartFile();
        fireEvent.click(screen.getByRole('button', { name: 'Attach Artwork' }));
        await screen.findByRole('form', { name: 'Review artwork upload' });
        fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));

        expect(await screen.findByText(
            'Not every part of the file is confirmed yet. The link review will open once the file is complete.',
        )).toBeInTheDocument();
        expect(screen.queryByRole('form', { name: 'Review artwork link' })).toBeNull();
        expect(client.getActionByIndex).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '71' });
        expect(client.composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('unsupported multipart artwork lane', () => {
    it('keeps the legacy cap for a hardware source', async () => {
        const hardware = { ...SOURCE, source: 'trezor' };
        const client = clientFor({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [hardware] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: hardware }),
        });
        mount(client);
        await screen.findByLabelText('Choose file to attach');
        expect(screen.queryByLabelText(/^Artwork file \(up to [\d.,]+ MB\)$/)).toBeNull();
        fireEvent.drop(artworkField(), {
            dataTransfer: { files: [new File([new Uint8Array(40_000)], 'art.txt', { type: 'text/plain' })] },
        });
        // A drop takes the same checks as a pick (the walk's file field).
        expect(await screen.findByRole('alert')).toHaveTextContent('on-chain ceiling is');
        fireEvent.change(screen.getByLabelText('Choose file to attach'), {
            target: { files: [new File(['picked'], 'art.txt', { type: 'text/plain' })] },
        });

        expect(await screen.findByRole('alert')).toHaveTextContent('on-chain ceiling is');
        fireEvent.click(screen.getByRole('button', { name: 'Attach Artwork' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Pick a file first.');
        expect(client.fileMultipart).not.toHaveBeenCalled();
    });
});
