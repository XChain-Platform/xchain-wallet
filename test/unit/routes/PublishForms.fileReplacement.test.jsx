// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AttachContentForm } from '../../../packages/core/src/shared/routes/AttachContentForm.jsx';
import { GatedPublishForm } from '../../../packages/core/src/shared/routes/GatedPublishForm.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

let readers;
let originalFileReader;

class ControlledFileReader {
    constructor() {
        this.result = null;
        readers.push(this);
    }

    readAsArrayBuffer() {}

    succeed(bytes = 2) {
        this.result = new ArrayBuffer(bytes);
        this.onload?.();
    }

    fail() {
        this.onerror?.(new Error('read failed'));
    }
}

function messaging() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listGatedKeys: vi.fn().mockResolvedValue([]),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 7 }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue([]);
        },
    });
}

function mount(ui, client = messaging()) {
    return render(<MessagingProvider shell="web" messaging={client}>{ui}</MessagingProvider>);
}

beforeEach(() => {
    readers = [];
    originalFileReader = globalThis.FileReader;
    globalThis.FileReader = ControlledFileReader;
});

afterEach(() => {
    cleanup();
    globalThis.FileReader = originalFileReader;
});

describe('publish forms replace file state safely', () => {
    it.each([
        ['public publish', () => mount(<PublishFileForm walletId="w" onBack={() => {}} />), 'Choose file to publish'],
        ['gated publish', () => mount(<GatedPublishForm walletId="w" chainId={CHAIN} tick="GATE" issuerAddress={SOURCE.address} onBack={() => {}} />), 'File to publish'],
        ['artwork attachment', () => mount(<AttachContentForm walletId="w" chainId={CHAIN} tick="ART" issuerAddress={SOURCE.address} onBack={() => {}} />), 'Choose file to attach'],
    ])('clears the previous file when a replacement read fails in %s', async (_name, mountRoute, inputLabel) => {
        mountRoute();
        const input = await screen.findByLabelText(inputLabel);
        fireEvent.change(input, {
            target: { files: [new File(['ok'], 'old.txt', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed());
        await waitFor(() => expect(document.body.textContent).toContain('old.txt'));

        fireEvent.change(input, {
            target: { files: [new File(['new'], 'replacement.txt', { type: 'text/plain' })] },
        });
        expect(document.body.textContent).not.toContain('old.txt');
        await act(async () => readers[1].fail());

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not read that file.');
        expect(document.body.textContent).not.toContain('old.txt');
    });

    it('rejects an empty gated file instead of advancing it to review', async () => {
        mount(
            <GatedPublishForm
                walletId="w"
                chainId={CHAIN}
                tick="GATE"
                issuerAddress={SOURCE.address}
                onBack={() => {}}
            />,
        );
        const input = await screen.findByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File([], 'empty.txt', { type: 'text/plain' })] },
        });

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That file is empty.'));
        expect(readers).toHaveLength(0);
    });

    it.each([
        ['public publish', () => mount(<PublishFileForm walletId="w" onBack={() => {}} />), 'Choose file to publish'],
        ['gated publish', () => mount(<GatedPublishForm walletId="w" chainId={CHAIN} tick="GATE" issuerAddress={SOURCE.address} onBack={() => {}} />), 'File to publish'],
        ['artwork attachment', () => mount(<AttachContentForm walletId="w" chainId={CHAIN} tick="ART" issuerAddress={SOURCE.address} onBack={() => {}} />), 'Choose file to attach'],
    ])('rejects malformed MIME metadata before reading in %s', async (_name, mountRoute, inputLabel) => {
        mountRoute();
        const input = await screen.findByLabelText(inputLabel);
        fireEvent.change(input, {
            target: { files: [new File(['bad'], 'bad.bin', { type: 'image/png;payload' })] },
        });

        expect(await screen.findByRole('alert')).toHaveTextContent('invalid content type');
        expect(readers).toHaveLength(0);
    });

    it('rejects a non-artwork file type before reading it', async () => {
        mount(<AttachContentForm walletId="w" chainId={CHAIN} tick="ART" issuerAddress={SOURCE.address} onBack={() => {}} />);
        const input = await screen.findByLabelText('Choose file to attach');
        fireEvent.change(input, {
            target: { files: [new File(['%PDF'], 'document.pdf', { type: 'application/pdf' })] },
        });

        expect(await screen.findByRole('alert')).toHaveTextContent('not accepted for artwork');
        expect(readers).toHaveLength(0);
    });

    it('ignores a stale public-file read that finishes after its replacement', async () => {
        mount(<PublishFileForm walletId="w" onBack={() => {}} />);
        const input = await screen.findByLabelText('Choose file to publish');
        fireEvent.change(input, {
            target: { files: [new File(['old'], 'old.txt', { type: 'text/plain' })] },
        });
        fireEvent.change(input, {
            target: { files: [new File(['new'], 'new.txt', { type: 'text/plain' })] },
        });

        await act(async () => readers[1].succeed(3));
        await waitFor(() => expect(document.body.textContent).toContain('new.txt'));
        await act(async () => readers[0].succeed(3));

        expect(document.body.textContent).toContain('new.txt');
        expect(document.body.textContent).not.toContain('old.txt');
    });

    it('uses the encoding-aware attachment cap and rechecks it after metadata edits', async () => {
        mount(<AttachContentForm walletId="w" chainId={CHAIN} tick="ART" issuerAddress={SOURCE.address} onBack={() => {}} />);
        const input = await screen.findByLabelText('Choose file to attach');
        const file = new File([new Uint8Array(8_080)], 'art.txt', { type: 'text/plain' });
        fireEvent.change(input, { target: { files: [file] } });
        await act(async () => readers[0].succeed(8_080));
        await waitFor(() => expect(document.body.textContent).toContain('art.txt'));

        fireEvent.change(screen.getByLabelText('Title (optional)'), {
            target: { value: 'x'.repeat(100) },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review upload' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Shorten the title or memo');
    });

    it('distinguishes a gated pack lookup failure from an empty pack list', async () => {
        const client = messaging();
        client.listGatedKeys.mockRejectedValue(new Error('offline'));
        mount(
            <GatedPublishForm
                walletId="w"
                chainId={CHAIN}
                tick="GATE"
                issuerAddress={SOURCE.address}
                onBack={() => {}}
            />,
            client,
        );

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load reusable packs');
        expect(document.body.textContent).not.toContain('No reusable packs in this wallet yet');
    });
});
