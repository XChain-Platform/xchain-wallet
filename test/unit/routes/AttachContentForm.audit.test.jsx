// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AttachContentForm } from '../../../packages/core/src/shared/routes/AttachContentForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qdevmock02aa',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

let OriginalFileReader;

class ImmediateFileReader {
    readAsArrayBuffer() {
        this.result = new Uint8Array([1, 2, 3]).buffer;
        queueMicrotask(() => this.onload?.());
    }
}

class PngFileReader {
    readAsArrayBuffer() {
        this.result = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
        queueMicrotask(() => this.onload?.());
    }
}

function messagingFor({ source = SOURCE, genesis, overrides = {} } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [source] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: source }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getGenesisForToken: genesis || vi.fn().mockResolvedValue({ action_index: 7 }),
        ...overrides,
    };
    return new Proxy(target, {
        get(value, property) {
            if (property in value) return value[property];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mount(client = messagingFor()) {
    render(
        <MessagingProvider shell="web" messaging={client}>
            <AttachContentForm
                walletId="wallet-1"
                chainId={CHAIN}
                tick="ART"
                issuerAddress={SOURCE.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return client;
}

async function chooseFile(name = 'art.txt', type = 'text/plain') {
    const input = await screen.findByLabelText('Choose file to attach');
    fireEvent.change(input, {
        target: { files: [new File(['abc'], name, { type })] },
    });
    await waitFor(() => expect(screen.getByText((_, element) => (
        element?.tagName === 'DD' && element.textContent === name
    ))).toBeInTheDocument());
}

async function review() {
    fireEvent.click(screen.getByRole('button', { name: 'Review upload' }));
}

beforeEach(() => {
    OriginalFileReader = globalThis.FileReader;
    globalThis.FileReader = ImmediateFileReader;
});

afterEach(() => {
    cleanup();
    globalThis.FileReader = OriginalFileReader;
});

describe('AttachContentForm validation and review', () => {
    it('shows normalized FILE values and keeps the draft when Back returns to the form', async () => {
        mount();
        await chooseFile(' art.png ', 'image/png');
        fireEvent.change(screen.getByLabelText('Title (optional)'), {
            target: { value: '  Gallery  ' },
        });
        fireEvent.change(screen.getByLabelText('Memo (optional)'), {
            target: { value: ' memo with spaces ' },
        });

        await review();
        expect(await screen.findByRole('form', { name: 'Review artwork upload' })).toBeInTheDocument();
        expect(screen.getByText('File').nextElementSibling).toHaveTextContent('art.png');
        expect(screen.getByText('Type').nextElementSibling).toHaveTextContent('image/png');
        expect(screen.getByText('Size').nextElementSibling).toHaveTextContent('3 bytes');
        expect(screen.getByText('Title').nextElementSibling).toHaveTextContent('Gallery');
        expect(screen.getByText('Memo').nextElementSibling.textContent).toBe(' memo with spaces ');

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(await screen.findByLabelText('Title (optional)')).toHaveValue('  Gallery  ');
        expect(screen.getByLabelText('Memo (optional)')).toHaveValue(' memo with spaces ');
        expect(screen.getByText((_, element) => (
            element?.tagName === 'DD' && element.textContent === ' art.png '
        ))).toBeInTheDocument();
    });

    it('refuses a memo beyond the network byte limit before review', async () => {
        mount();
        await chooseFile();
        fireEvent.change(screen.getByLabelText('Memo (optional)'), {
            target: { value: 'é'.repeat(126) },
        });

        await review();

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Memo is 252 bytes; the network accepts at most 250 bytes.',
        );
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();
    });

    it('refuses a title beyond its field limit before review', async () => {
        mount();
        await chooseFile();
        fireEvent.change(screen.getByLabelText('Title (optional)'), {
            target: { value: 'x'.repeat(101) },
        });

        await review();

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Title cannot be longer than 100 characters.',
        );
    });

    it.each([
        ['', 'Enter a custom fee rate greater than zero.'],
        ['0', 'Enter a custom fee rate greater than zero.'],
        ['-1', 'Enter a custom fee rate greater than zero.'],
        ['0.123456789', 'Custom fee rate can have at most 8 decimal places.'],
        ['0.00000001', 'Custom fee rate is too small to encode. Enter a larger rate.'],
        ['100000000000000000000', 'Custom fee rate is too high. Enter a smaller rate.'],
    ])('refuses custom fee %j before review', async (rate, message) => {
        mount();
        await chooseFile();
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), {
            target: { value: '3' },
        });
        fireEvent.change(await screen.findByLabelText('Custom fee rate (sat/vB)'), {
            target: { value: rate },
        });

        await review();

        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();
    });

    it('refreshes the token creation record and refuses a stale result', async () => {
        const genesis = vi.fn()
            .mockResolvedValueOnce({ action_index: 7 })
            .mockRejectedValueOnce(new Error('offline'));
        const client = mount(messagingFor({ genesis }));
        await chooseFile();
        await waitFor(() => expect(client.getGenesisForToken).toHaveBeenCalledTimes(1));

        await review();

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "Couldn't refresh the creation record for ART. Check your connection and try again.",
        );
        expect(client.getGenesisForToken).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();
    });

    it('refuses a malformed refreshed token action number', async () => {
        const genesis = vi.fn()
            .mockResolvedValueOnce({ action_index: 7 })
            .mockResolvedValueOnce({ action_index: 0 });
        mount(messagingFor({ genesis }));
        await chooseFile();

        await review();

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'The creation record for ART returned an invalid action number. Try again later.',
        );
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();
    });

    it('refuses a malformed selected signing address', async () => {
        mount(messagingFor({ source: { ...SOURCE, address: 'not-an-address' } }));
        await chooseFile();

        await review();

        expect(await screen.findByText(
            'The selected signing address is not valid for Bitcoin.',
        )).toBeInTheDocument();
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();
    });

    it('refuses a selected signing address with a malformed wallet ID', async () => {
        mount(messagingFor({ source: { ...SOURCE, id: 7 } }));
        await chooseFile();

        await review();

        expect(await screen.findByText(
            'The selected signing address is missing its wallet ID. Choose another address.',
        )).toBeInTheDocument();
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();
    });

    it('keeps polling and shows plain copy for a malformed indexed file number', async () => {
        const client = messagingFor({
            overrides: {
                composeForConfirm: vi.fn().mockResolvedValue({
                    psbt: 'aa00',
                    encoding: 'psbt',
                    version: 1,
                    chainId: CHAIN,
                    actionString: 'FILE|0|art.txt|text/plain',
                    decoded: { summary: 'Upload file', details: [], warnings: [] },
                }),
                preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
                fileAction: vi.fn().mockResolvedValue({ txid: 'file-tx' }),
                getActionByTxid: vi.fn().mockResolvedValue({ action_index: 0 }),
            },
        });
        mount(client);
        await chooseFile();
        await review();
        await screen.findByRole('form', { name: 'Review artwork upload' });

        fireEvent.click(screen.getByRole('button', { name: 'Upload file' }));
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);

        expect(await screen.findByText(
            'The network returned an invalid action number for the file. The wallet will keep checking.',
        )).toBeInTheDocument();
        expect(client.getActionByTxid).toHaveBeenCalledWith({
            chainId: CHAIN,
            txid: 'file-tx',
        });
    });

    it('shows the exact LINK and token-info values passed to composition', async () => {
        globalThis.FileReader = PngFileReader;
        const client = messagingFor({
            overrides: {
                composeForConfirm: vi.fn().mockResolvedValue({
                    psbt: 'aa00',
                    encoding: 'psbt',
                    version: 1,
                    chainId: CHAIN,
                    actionString: 'encoded action',
                    decoded: { summary: 'Review action', details: [], warnings: [] },
                }),
                preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
                fileAction: vi.fn().mockResolvedValue({ txid: 'file-tx' }),
                linkAction: vi.fn().mockResolvedValue({ txid: 'link-tx' }),
                getActionByTxid: vi.fn().mockResolvedValue({ action_index: 12 }),
            },
        });
        mount(client);
        await chooseFile('art.png', 'image/png');
        fireEvent.change(screen.getByLabelText('Title (optional)'), {
            target: { value: ' Gallery ' },
        });
        fireEvent.click(screen.getByRole('checkbox'));
        await review();
        await screen.findByRole('form', { name: 'Review artwork upload' });

        fireEvent.click(screen.getByRole('button', { name: 'Upload file' }));
        let approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);

        await screen.findByRole('form', { name: 'Review artwork link' });
        expect(screen.getByText('Artwork file record').nextElementSibling).toHaveTextContent('BTC#12');
        expect(screen.getByText('Token creation record').nextElementSibling).toHaveTextContent('BTC#7');
        fireEvent.click(screen.getByRole('button', { name: 'Link artwork to ART' }));
        approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);

        const expectedJson = JSON.stringify({
            tick: 'ART',
            categories: [{ type: 'main', data: 'NFT' }],
            images: [{ data_ref: 'action:12', type: 'image/png', name: 'art.png' }],
            name: 'Gallery',
        });
        await screen.findByRole('form', { name: 'Upload token info' });
        expect(screen.getByText('Document').nextElementSibling).toHaveTextContent('ART.json');
        expect(screen.getByText('Type').nextElementSibling).toHaveTextContent('application/json');
        expect(screen.getByText('Title').nextElementSibling).toHaveTextContent('Token information');
        expect(screen.getByText('Contents').nextElementSibling.textContent).toBe(expectedJson);

        fireEvent.click(screen.getByRole('button', { name: 'Upload token info' }));
        await waitFor(() => expect(client.composeForConfirm).toHaveBeenCalledTimes(3));
        expect(client.composeForConfirm.mock.calls[1][0].actionData.params).toEqual({
            VERSION: '0',
            COIN1: 'BTC',
            COIN1_ACTION_INDEX: '12',
            COIN2: 'BTC',
            COIN2_ACTION_INDEX: '7',
            MEMO: '',
        });
        expect(client.composeForConfirm.mock.calls[2][0]).toMatchObject({
            actionData: {
                action: 'FILE',
                params: {
                    VERSION: '0',
                    NAME: 'ART.json',
                    TYPE: 'application/json',
                    TITLE: 'Token information',
                    MEMO: '',
                },
            },
            encoderOpts: { rawData: expectedJson },
        });
    });
});
