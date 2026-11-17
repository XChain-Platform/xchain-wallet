// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Attach Artwork sizes its ceiling exactly as Publish file does: the Taproot
// envelope ceiling where the chain does Taproot and the signer can sign the
// reveal, the legacy compiled ceiling otherwise. The FILE compose requests the
// same encoding the ceiling was sized from.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AttachContentForm } from '../../../packages/core/src/shared/routes/AttachContentForm.jsx';
import { maxPublicFileBytes } from '../../../packages/core/src/flows/fileSizeLimits.js';
import { formatBytes } from '../../../packages/core/src/shared/utils/formatBytes.js';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';

function record(chainId, address) {
    return Object.freeze({
        id: `addr-${chainId}`,
        address,
        publicKey: '02aa',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        signerId: 'signer-1',
    });
}

class PngFileReader {
    readAsArrayBuffer() {
        this.result = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
        queueMicrotask(() => this.onload?.());
    }
}

let OriginalFileReader;

function messagingFor(chainId, owner, overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [chainId]: [owner] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [chainId]: owner }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 7 }),
        ...overrides,
    };
    return new Proxy(target, {
        get(value, property) {
            if (property in value) return value[property];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mount(chainId, owner, client) {
    render(
        <MessagingProvider shell="web" messaging={client}>
            <AttachContentForm
                walletId="wallet-1"
                chainId={chainId}
                tick="ART"
                issuerAddress={owner.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

// The label reads "Artwork file (up to N KB)"; the same formatter Publish file
// uses turns the metadata-aware ceiling into that text.
function labelFor(cap) {
    return `Artwork file (up to ${formatBytes(cap, { limit: true })})`;
}

beforeEach(() => {
    OriginalFileReader = globalThis.FileReader;
    globalThis.FileReader = PngFileReader;
});

afterEach(() => {
    cleanup();
    globalThis.FileReader = OriginalFileReader;
});

describe('AttachContentForm artwork ceiling matches Publish file', () => {
    it('offers the envelope ceiling on Bitcoin, the Publish file figure for the same metadata', async () => {
        const owner = record(BTC, 'bc1qdevmock02aa');
        mount(BTC, owner, messagingFor(BTC, owner));
        await waitFor(() => expect(screen.getByLabelText('From address')).toHaveValue(owner.address));

        const cap = maxPublicFileBytes(
            { name: 'file', type: 'application/octet-stream', title: '', memo: '' },
            { encoding: 'TAPROOT' },
        );
        expect(cap).toBeGreaterThan(300_000);
        expect(screen.getByLabelText(labelFor(cap))).toBeInTheDocument();

        // Metadata takes room from the file exactly as in Publish file.
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A gallery title' } });
        const titled = maxPublicFileBytes(
            { name: 'file', type: 'application/octet-stream', title: 'A gallery title', memo: '' },
            { encoding: 'TAPROOT' },
        );
        expect(screen.getByLabelText(labelFor(titled))).toBeInTheDocument();
    });

    it('keeps the legacy ceiling on Dogecoin, the Publish file figure for the same metadata', async () => {
        const owner = record(DOGE, 'DDogepartyxxxxxxxxxxxxxxxxxxw1dfzr');
        mount(DOGE, owner, messagingFor(DOGE, owner));
        await waitFor(() => expect(screen.getByLabelText('From address')).toHaveValue(owner.address));

        const cap = maxPublicFileBytes({ name: 'file', type: 'application/octet-stream', title: '', memo: '' });
        expect(cap).toBeLessThan(8192);
        expect(screen.getByLabelText(labelFor(cap))).toBeInTheDocument();
    });

    it('names the real ceiling in the refusal and drops the URL advice at the envelope ceiling', async () => {
        const owner = record(BTC, 'bc1qdevmock02aa');
        mount(BTC, owner, messagingFor(BTC, owner));
        await waitFor(() => expect(screen.getByLabelText('From address')).toHaveValue(owner.address));

        fireEvent.change(screen.getByLabelText('Choose file to attach'), {
            target: { files: [new File([new Uint8Array(400_000)], 'huge.png', { type: 'image/png' })] },
        });
        const refusal = await screen.findByText(/That file is 390\.7 KB; with this title and memo the on-chain ceiling is/);
        expect(refusal.textContent).not.toMatch(/image URL/);
    });

    it('requests the envelope encoding for the FILE compose where it is available', async () => {
        const owner = record(BTC, 'bc1qdevmock02aa');
        const client = messagingFor(BTC, owner, {
            composeForConfirm: vi.fn().mockResolvedValue({
                psbt: 'aa00',
                encoding: 'psbt',
                version: 1,
                chainId: BTC,
                actionString: 'FILE|0|art.png|image/png',
                decoded: { summary: 'Upload file', details: [], warnings: [] },
            }),
            preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        });
        mount(BTC, owner, client);
        await waitFor(() => expect(screen.getByLabelText('From address')).toHaveValue(owner.address));
        fireEvent.change(screen.getByLabelText('Choose file to attach'), {
            target: { files: [new File(['x'], 'art.png', { type: 'image/png' })] },
        });
        await screen.findByText('art.png');
        fireEvent.click(screen.getByRole('button', { name: 'Attach Artwork' }));
        await screen.findByRole('form', { name: 'Review artwork upload' });
        fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));

        await waitFor(() => expect(client.composeForConfirm).toHaveBeenCalledTimes(1));
        const request = client.composeForConfirm.mock.calls[0][0];
        expect(request.actionData.action).toBe('FILE');
        expect(request.encoderOpts.encoding).toBe('AUTO');
        expect(request.encoderOpts.options).toBeTruthy();
    });

    it('leaves the encoding unset for the FILE compose on Dogecoin', async () => {
        const owner = record(DOGE, 'DDogepartyxxxxxxxxxxxxxxxxxxw1dfzr');
        const client = messagingFor(DOGE, owner, {
            composeForConfirm: vi.fn().mockResolvedValue({
                psbt: 'aa00',
                encoding: 'psbt',
                version: 1,
                chainId: DOGE,
                actionString: 'FILE|0|art.png|image/png',
                decoded: { summary: 'Upload file', details: [], warnings: [] },
            }),
            preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        });
        mount(DOGE, owner, client);
        await waitFor(() => expect(screen.getByLabelText('From address')).toHaveValue(owner.address));
        fireEvent.change(screen.getByLabelText('Choose file to attach'), {
            target: { files: [new File(['x'], 'art.png', { type: 'image/png' })] },
        });
        await screen.findByText('art.png');
        fireEvent.click(screen.getByRole('button', { name: 'Attach Artwork' }));
        await screen.findByRole('form', { name: 'Review artwork upload' });
        fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));

        await waitFor(() => expect(client.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(client.composeForConfirm.mock.calls[0][0].encoderOpts.encoding).toBeUndefined();
    });
});
