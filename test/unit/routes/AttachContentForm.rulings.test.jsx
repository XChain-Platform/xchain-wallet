// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AttachContentForm } from '../../../packages/core/src/shared/routes/AttachContentForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = Object.freeze({
    id: 'addr-owner',
    address: 'bc1qdevmock02aa',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const OTHER = Object.freeze({
    id: 'addr-other',
    address: 'bc1qdevmock02bb',
    publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/1",
    source: 'hd',
    signerId: 'signer-1',
});

// The full-page own-address picker is its own screen with its own tests;
// here it only has to report what it was opened with and hand back a pick.
const pickerProps = vi.hoisted(() => ({ last: null }));
vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: (props) => {
        pickerProps.last = props;
        return (
            <div data-testid="own-address-picker">
                <button type="button" onClick={() => props.onPick({ id: 'addr-other', address: 'bc1qdevmock02bb' })}>
                    Pick other address
                </button>
            </div>
        );
    },
}));

class PngFileReader {
    readAsArrayBuffer() {
        this.result = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
        queueMicrotask(() => this.onload?.());
    }
}

let OriginalFileReader;

function messagingFor({ addresses = [OWNER], active = OWNER, overrides = {} } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: addresses }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: active }),
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

function mount(client = messagingFor(), issuerAddress = OWNER.address) {
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

async function composeReady() {
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(OWNER.address));
}

function precedes(a, b) {
    // eslint-disable-next-line no-bitwise
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

// The form's own buttons; the shared fee selector and the label-line
// InfoTip triggers are shared ui with their own tests.
function expectButtonsHaveIcons(container, names) {
    for (const name of names) {
        const button = within(container).getByRole('button', { name });
        expect(button.querySelector('svg'), `button "${name}" has no icon`).not.toBeNull();
    }
}

function expectOneGreenAction(form, name) {
    const green = form.querySelectorAll(`button.${buttonStyles.success}`);
    expect(green).toHaveLength(1);
    expect(green[0]).toHaveAccessibleName(name);
}

beforeEach(() => {
    pickerProps.last = null;
    OriginalFileReader = globalThis.FileReader;
    globalThis.FileReader = PngFileReader;
});

afterEach(() => {
    cleanup();
    globalThis.FileReader = OriginalFileReader;
});

describe('AttachContentForm app-wide form rulings', () => {
    it('starts with Network, then From, then the fixed Token, then the artwork file', async () => {
        mount();
        await composeReady();

        const network = screen.getByRole('button', { name: /^Network: Bitcoin/ });
        const from = screen.getByLabelText('From');
        const token = screen.getByRole('button', { name: /^Token: ART on Bitcoin/ });
        const fileGroup = screen.getByRole('group', { name: 'Artwork file' });
        const title = screen.getByLabelText('Title');
        const memo = screen.getByLabelText('Memo');

        expect(from).toHaveAttribute('readonly');
        expect(token).toBeDisabled();
        expect(precedes(network, from)).toBe(true);
        expect(precedes(from, token)).toBe(true);
        expect(precedes(token, fileGroup)).toBe(true);
        expect(precedes(fileGroup, title)).toBe(true);
        expect(precedes(title, memo)).toBe(true);
    });

    it('offers only the token chain on the Network field', async () => {
        mount();
        await composeReady();

        fireEvent.click(screen.getByRole('button', { name: /^Network: Bitcoin/ }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getAllByRole('button', { name: /Bitcoin/ }).length).toBeGreaterThan(0);
        expect(within(dialog).queryByRole('button', { name: /Litecoin|Dogecoin/ })).toBeNull();
    });

    it('seeds From with the owner address even when another address is active', async () => {
        mount(messagingFor({ addresses: [OTHER, OWNER], active: OTHER }));
        await composeReady();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('opens the own-address picker locked to the token chain and shows the owner mismatch for a non-owner pick', async () => {
        mount(messagingFor({ addresses: [OWNER, OTHER] }));
        await composeReady();
        expect(screen.getByRole('button', { name: 'Attach artwork' })).toBeEnabled();

        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        expect(await screen.findByTestId('own-address-picker')).toBeInTheDocument();
        expect(pickerProps.last).toMatchObject({ chainId: CHAIN, lockNetwork: true, walletId: 'wallet-1' });

        fireEvent.click(screen.getByRole('button', { name: 'Pick other address' }));

        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(OTHER.address));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'The selected source address does not own ART. Choose the current owner address.',
        );
        expect(screen.getByRole('button', { name: 'Attach artwork' })).toBeDisabled();
    });

    it('labels the file chooser with a help tip and keeps only the live limit under it', async () => {
        mount();
        await composeReady();

        const group = screen.getByRole('group', { name: 'Artwork file' });
        const limit = document.getElementById(group.getAttribute('aria-describedby'));
        expect(limit.textContent).toMatch(/^Up to [\d,]+ bytes with the current title and memo\.$/);
        const before = Number(limit.textContent.match(/[\d,]+/)[0].replace(/,/g, ''));

        // The intro and the static advice live only in the tip now.
        for (const pattern of [/Two signatures: one to upload the file/, /A compact image/]) {
            const matches = screen.queryAllByText(pattern, { ignore: false });
            expect(matches.length).toBeGreaterThan(0);
            for (const node of matches) expect(node.closest('[role="tooltip"]')).not.toBeNull();
        }
        expect(screen.queryByText(/Keep it small/)).toBeNull();
        expect(screen.queryByText(/Store the artwork on the chain itself/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'About Artwork file' }));
        expect(await screen.findByText(/Two signatures: one to upload the file, one to make it official\. A compact image \(SVG, small PNG\/JPEG\/WebP\) works best\./))
            .toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A gallery title' } });
        const after = Number(limit.textContent.match(/[\d,]+/)[0].replace(/,/g, ''));
        expect(after).toBeLessThan(before);

        const input = screen.getByLabelText('Choose file to attach');
        fireEvent.change(input, { target: { files: [new File(['x'], 'art.png', { type: 'image/png' })] } });
        expect(await screen.findByText('art.png')).toBeInTheDocument();
        expect(limit.textContent).toMatch(/^Up to [\d,]+ bytes with the current title and memo\.$/);
    });

    it('shows the Optional pill, help tip and counter on the Title and Memo label lines', async () => {
        mount();
        await composeReady();

        expect(screen.getAllByText('Optional')).toHaveLength(2);
        expect(screen.queryByText(/\(optional\)/i)).toBeNull();
        expect(screen.getByText('0 / 100')).toBeInTheDocument();
        expect(screen.getByText('0 / 250')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Title' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Memo' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About From' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Network' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Token' })).toBeInTheDocument();
    });

    it('keeps the plain Network fee field and no protocol-fee toggle or Fees card', async () => {
        mount();
        await composeReady();

        expect(screen.getByRole('slider', { name: 'Network fee' })).toBeInTheDocument();
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.queryByText(/protocol fee/i)).toBeNull();
        expect(screen.queryByText('Total')).toBeNull();
    });

    it('makes each stage main action green with an icon, and gives every button an icon', async () => {
        let releaseTis = () => {};
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
                fileAction: vi.fn()
                    .mockResolvedValueOnce({ txid: 'file-tx' })
                    .mockResolvedValueOnce({ txid: 'tis-tx' }),
                linkAction: vi.fn().mockResolvedValue({ txid: 'link-tx' }),
                issueToken: vi.fn().mockResolvedValue({ txid: 'desc-tx' }),
                getActionByTxid: vi.fn()
                    .mockResolvedValueOnce({ action_index: 12 })
                    .mockImplementationOnce(() => new Promise((resolve) => {
                        releaseTis = () => resolve({ action_index: 13 });
                    })),
            },
        });
        mount(client);
        await composeReady();

        let form = screen.getByRole('form', { name: 'Attach artwork' });
        expectOneGreenAction(form, 'Attach artwork');
        expectButtonsHaveIcons(form, ['Attach artwork', 'Choose a file']);

        fireEvent.change(screen.getByLabelText('Choose file to attach'), {
            target: { files: [new File(['x'], 'art.png', { type: 'image/png' })] },
        });
        await screen.findByText('art.png');
        expect(screen.getByRole('button', { name: 'Choose a different file' }).querySelector('svg')).not.toBeNull();
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Attach artwork' }));

        form = await screen.findByRole('form', { name: 'Review artwork upload' });
        expectOneGreenAction(form, 'Upload file');
        expectButtonsHaveIcons(form, ['Back', 'Upload file']);
        fireEvent.click(within(form).getByRole('button', { name: 'Upload file' }));
        let approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);

        form = await screen.findByRole('form', { name: 'Review artwork link' });
        expectOneGreenAction(form, 'Link artwork to ART');
        expectButtonsHaveIcons(form, ['Link artwork to ART']);
        fireEvent.click(within(form).getByRole('button', { name: 'Link artwork to ART' }));
        approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);

        form = await screen.findByRole('form', { name: 'Upload token info' });
        expectOneGreenAction(form, 'Upload token info');
        expectButtonsHaveIcons(form, ['Skip (artwork only)', 'Upload token info']);
        fireEvent.click(within(form).getByRole('button', { name: 'Upload token info' }));
        approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);

        // The token-info wait stage: its only button is the ghost Close.
        const close = await screen.findByRole('button', { name: 'Close (keep waiting)' });
        expect(close.querySelector('svg')).not.toBeNull();
        expect(close).not.toHaveClass(buttonStyles.success);
        await act(async () => { releaseTis(); });

        form = await screen.findByRole('form', { name: 'Update token description' });
        expectOneGreenAction(form, 'Update description');
        expectButtonsHaveIcons(form, ['Skip', 'Update description']);
        fireEvent.click(within(form).getByRole('button', { name: 'Skip' }));

        const done = await screen.findByRole('button', { name: 'Done' });
        expect(done).toHaveClass(buttonStyles.success);
        expect(done.querySelector('svg')).not.toBeNull();
    }, 30000);
});
