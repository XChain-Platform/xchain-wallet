// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The artwork file is the standard file field: a picked and a dropped file
// take the same checks, and a file far over the ceiling is refused unread.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AttachContentForm } from '../../../packages/core/src/shared/routes/AttachContentForm.jsx';
import { MULTIPART_FILE_MAX_BYTES } from '../../../packages/core/src/flows/fileSizeLimits.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = Object.freeze({
    id: 'addr-owner',
    address: 'bc1qdevmock02aa',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const reads = vi.hoisted(() => ({ count: 0 }));

class PngFileReader {
    readAsArrayBuffer() {
        reads.count += 1;
        this.result = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
        queueMicrotask(() => this.onload?.());
    }
}

let OriginalFileReader;

function mount() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: OWNER }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 7 }),
    };
    const client = new Proxy(target, {
        get(value, property) {
            if (property in value) return value[property];
            return vi.fn().mockResolvedValue({});
        },
    });
    render(
        <MessagingProvider shell="web" messaging={client}>
            <AttachContentForm walletId="wallet-1" chainId={CHAIN} tick="ART" issuerAddress={OWNER.address} onBack={() => {}} />
        </MessagingProvider>,
    );
}

function oversizePng() {
    // Past every ceiling the form offers on Bitcoin, the multi-part one included.
    // The ceiling is far too large to allocate, so the File reports the size.
    const file = new File([new Uint8Array(8)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: MULTIPART_FILE_MAX_BYTES + 1 });
    return file;
}

beforeEach(() => {
    reads.count = 0;
    OriginalFileReader = globalThis.FileReader;
    globalThis.FileReader = PngFileReader;
});

afterEach(() => {
    globalThis.FileReader = OriginalFileReader;
    cleanup();
});

describe('AttachContentForm file field', () => {
    it('refuses a picked file far over the ceiling before reading it', async () => {
        mount();
        fireEvent.change(await screen.findByLabelText('Choose file to attach'), { target: { files: [oversizePng()] } });
        expect(await screen.findByText(/That file is [\d.,]+ MB; with this title and memo the on-chain ceiling is [\d.,]+ (KB|MB)\./))
            .toBeInTheDocument();
        expect(reads.count).toBe(0);
    });

    it('takes a dropped file through the same checks as a picked one', async () => {
        mount();
        const field = (await screen.findByLabelText(/^Artwork file \(up to [\d.,]+ KB\)$/)).closest('[data-file-field]');
        fireEvent.drop(field, { dataTransfer: { files: [oversizePng()] } });
        expect(await screen.findByText(/That file is [\d.,]+ MB/)).toBeInTheDocument();
        expect(reads.count).toBe(0);

        fireEvent.drop(field, { dataTransfer: { files: [new File(['x'], 'art.png', { type: 'image/png' })] } });
        await waitFor(() => expect(screen.getByLabelText(/^Artwork file \(up to [\d.,]+ KB\)$/)).toHaveValue('art.png'));
        expect(reads.count).toBe(1);
    });
});
