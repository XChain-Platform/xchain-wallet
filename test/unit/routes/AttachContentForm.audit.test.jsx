// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { typeCustomRate } from '../../helpers/customNetworkFee.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AttachContentForm } from '../../../packages/core/src/shared/routes/AttachContentForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qdevmock02aa',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const UNKNOWN_ISSUER = "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.";

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

function mount(client = messagingFor(), issuerAddress = SOURCE.address) {
    render(
        <MessagingProvider shell="web" messaging={client}>
            <AttachContentForm
                walletId="wallet-1"
                chainId={CHAIN}
                tick="ART"
                issuerAddress={issuerAddress}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return client;
}

async function chooseFile(name = 'art.txt', type = 'text/plain') {
    // The artwork file is the standard file field; its hidden picker input
    // carries its own name beside the visible label with the ceiling.
    const input = await screen.findByLabelText('Choose file to attach');
    fireEvent.change(input, {
        target: { files: [new File(['abc'], name, { type })] },
    });
    await waitFor(() => expect(screen.getByText((_, element) => (
        element?.tagName === 'DD' && element.textContent === name
    ))).toBeInTheDocument());
}

async function review() {
    // The standard action label is Title Case.
    fireEvent.click(screen.getByRole('button', { name: 'Attach Artwork' }));
}

// Opens a closed standard section by its title.
function openSection(title) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${title}\\b`), expanded: false }));
}

function compositionClient() {
    return messagingFor({
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
}

async function reachTokenInfoReview(client) {
    globalThis.FileReader = PngFileReader;
    mount(client);
    await chooseFile('art.png', 'image/png');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: ' Gallery ' } });
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
    await screen.findByRole('form', { name: 'Upload token info' });
}

beforeEach(() => {
    OriginalFileReader = globalThis.FileReader;
    globalThis.FileReader = ImmediateFileReader;
});

afterEach(() => {
    cleanup();
    globalThis.FileReader = OriginalFileReader;
    __clearTokenInfoCache();
});

describe('AttachContentForm validation and review', () => {
    it('refuses before review when the issuer is unknown', async () => {
        const client = messagingFor();
        mount(client, null);

        // The owner read settles after mount, so the wait is on the text.
        await waitFor(() => expect(screen.getAllByText(UNKNOWN_ISSUER).length).toBeGreaterThan(0));
        // G130: the button keeps its colour and a tap is refused at the top.
        const attach = screen.getByRole('button', { name: 'Attach Artwork' });
        expect(attach).toBeEnabled();
        await chooseFile();
        fireEvent.click(attach);
        await waitFor(() => expect(screen.getAllByText(UNKNOWN_ISSUER).length).toBeGreaterThan(0));
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();
        expect(client.composeForConfirm).not.toHaveBeenCalled();
    });

    // The regtest roster trace (2026-11-18): the owner row was tapped 80 ms
    // after the token page mounted, before its token read named the owner, so
    // the form opened with no issuer and stayed refused for good.
    it('reads the owner itself when it opens before the token page named one', async () => {
        const client = messagingFor({ overrides: {
            getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'ART', creator: SOURCE.address }),
        } });
        mount(client, null);
        await chooseFile('art.png', 'image/png');
        await review();
        expect(await screen.findByRole('form', { name: 'Review artwork upload' })).toBeInTheDocument();
        expect(screen.queryByText(UNKNOWN_ISSUER)).toBeNull();
    });

    it('answers a tap while the owner read is in flight with the wait refusal', async () => {
        const client = messagingFor({ overrides: { getTokenInfo: vi.fn(() => new Promise(() => {})) } });
        mount(client, null);
        await chooseFile();
        const attach = screen.getByRole('button', { name: 'Attach Artwork' });
        expect(attach).toBeEnabled();
        fireEvent.click(attach);
        await waitFor(() => expect(screen.getAllByText('Wait for the wallet to verify the current owner of ART.').length).toBeGreaterThan(0));
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();
    });

    it('asks the explorer again when a tap follows a failed owner read', async () => {
        const getTokenInfo = vi.fn()
            .mockResolvedValueOnce({ chainId: CHAIN, tick: 'ART', loadError: true })
            .mockResolvedValue({ chainId: CHAIN, tick: 'ART', creator: SOURCE.address });
        mount(messagingFor({ overrides: { getTokenInfo } }), null);
        await waitFor(() => expect(screen.getAllByText(UNKNOWN_ISSUER).length).toBeGreaterThan(0));
        await chooseFile('art.png', 'image/png');
        await review();
        // The refused tap asks again; the next tap goes through.
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledTimes(2));
        await review();
        expect(await screen.findByRole('form', { name: 'Review artwork upload' })).toBeInTheDocument();
    });

    it('shows normalized FILE values and keeps the draft when Back returns to the form', async () => {
        mount();
        await chooseFile(' art.png ', 'image/png');
        fireEvent.change(screen.getByLabelText('Title'), {
            target: { value: '  Gallery  ' },
        });
        fireEvent.change(screen.getByLabelText('Memo'), {
            target: { value: ' memo with spaces ' },
        });

        await review();
        expect(await screen.findByRole('form', { name: 'Review artwork upload' })).toBeInTheDocument();
        expect(screen.getByText('File').nextElementSibling).toHaveTextContent('art.png');
        expect(screen.getByText('Type').nextElementSibling).toHaveTextContent('image/png');
        // Sizes read in KB, never bytes; a 3-byte file reads as the 0.1 KB floor.
        expect(screen.getByText('Size').nextElementSibling).toHaveTextContent('0.1 KB');
        expect(screen.getByText('Title').nextElementSibling).toHaveTextContent('Gallery');
        expect(screen.getByText('Memo').nextElementSibling.textContent).toBe(' memo with spaces ');

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(await screen.findByLabelText('Title')).toHaveValue('  Gallery  ');
        expect(screen.getByLabelText('Memo')).toHaveValue(' memo with spaces ');
        expect(screen.getByText((_, element) => (
            element?.tagName === 'DD' && element.textContent === ' art.png '
        ))).toBeInTheDocument();
    });
});

describe('AttachContentForm metadata validation', () => {
    it('refuses a memo beyond the network character limit before review', async () => {
        mount();
        await chooseFile();
        fireEvent.change(screen.getByLabelText('Memo'), {
            target: { value: `${'😀'.repeat(125)}aa` },
        });

        await review();

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Memo is 252 characters; the network accepts at most 250 characters.',
        );
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();
        // The refusal reopens the closed Memo section holding the field.
        expect(screen.getByRole('button', { name: /^Memo\b/ })).toHaveAttribute('aria-expanded', 'true');
    });
});

describe('AttachContentForm title safety', () => {
    it('refuses a title beyond its field limit before review', async () => {
        mount();
        await chooseFile();
        fireEvent.change(screen.getByLabelText('Title'), {
            target: { value: 'x'.repeat(101) },
        });

        await review();

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Title cannot be longer than 100 characters.',
        );
    });

    it.each([
        ['Title', 'safe\u202eunsafe', 'Title cannot contain text-direction control characters.'],
        ['Memo', 'safe\u200bunsafe', 'Memo cannot contain zero-width characters.'],
    ])('refuses hostile %s text before review', async (label, value, message) => {
        mount();
        await chooseFile();
        fireEvent.change(screen.getByLabelText(label), { target: { value } });

        await review();

        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();
    });
});

describe('AttachContentForm custom fee validation', () => {
    // Typed into the one custom fee editor, the Network fee line (G113), as
    // the fee each named rate prices to; a rate of more than 8 decimals
    // cannot be typed there any more.
    it.each([
        ['', 'Enter a custom network fee.'],
        ['0', 'Custom fee rate must be greater than zero.'],
        ['-1', 'Enter a valid non-negative network fee amount.'],
        ['0.5', 'Enter a rate of at least 1 sat/vB.'],
        ['0.00000001', 'Enter a rate of at least 1 sat/vB.'],
        ['50000', 'Enter a rate no higher than 1,000 sat/vB.'],
    ])('refuses custom fee %j before review', async (rate, message) => {
        mount();
        await chooseFile();
        openSection('Speed and Fees');
        await typeCustomRate(rate);

        await review();

        expect(await screen.findAllByText(message)).toHaveLength(1);
        expect(screen.queryByRole('form', { name: 'Review artwork upload' })).toBeNull();
    });
});

describe('AttachContentForm refreshed genesis', () => {
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
});

describe('AttachContentForm malformed genesis index', () => {
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
});

describe('AttachContentForm signing address validation', () => {
    it('refuses a malformed selected signing address', async () => {
        mount(messagingFor({ source: { ...SOURCE, address: 'not-an-address' } }), 'not-an-address');
        await chooseFile();

        await review();

        expect(await screen.findByText(
            'The selected signing address is not valid for this network.',
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
});

describe('AttachContentForm indexed file validation', () => {
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

        fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));
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
});

describe('AttachContentForm link leg and page title', () => {
    it('always reaches the link step and ends after it, with no token-info leg', async () => {
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
        fireEvent.change(screen.getByLabelText('Title'), {
            target: { value: ' Gallery ' },
        });
        expect(screen.queryByRole('checkbox')).toBeNull();
        await review();
        await screen.findByRole('form', { name: 'Review artwork upload' });

        fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));
        let approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);

        await screen.findByRole('form', { name: 'Review artwork link' });
        expect(screen.getByText('Artwork file record').nextElementSibling).toHaveTextContent('BTC#12');
        expect(screen.getByText('Token creation record').nextElementSibling).toHaveTextContent('BTC#7');
        fireEvent.click(screen.getByRole('button', { name: 'Link Artwork to ART' }));
        approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);

        // The link is the last leg: the flow ends on Done with both txids.
        expect(await screen.findByRole('button', { name: 'Done' })).toBeInTheDocument();
        expect(screen.queryByRole('form', { name: 'Upload token info' })).toBeNull();
        expect(client.composeForConfirm).toHaveBeenCalledTimes(2);
        expect(client.composeForConfirm.mock.calls[1][0].actionData.params).toEqual({
            VERSION: '0',
            COIN1: 'BTC',
            COIN1_ACTION_INDEX: '12',
            COIN2: 'BTC',
            COIN2_ACTION_INDEX: '7',
            MEMO: '',
        });
    });

    it('titles the page Attach Artwork without the token name', async () => {
        mount();
        expect(await screen.findByRole('heading', { name: 'Attach Artwork' })).toBeInTheDocument();
        expect(screen.queryByText('Attach Artwork to ART')).toBeNull();
        expect(screen.queryByText(/Token Picture/)).toBeNull();
    });
});
