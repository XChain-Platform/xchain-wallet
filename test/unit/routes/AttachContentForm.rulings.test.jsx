// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    // The standard From section labels the field "From address".
    await waitFor(() => expect(screen.getByLabelText('From address')).toHaveValue(OWNER.address));
}

// Opens a closed standard section by its title.
function openSection(title) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${title}\\b`), expanded: false }));
}

// The ceiling reads in KB or MB, rounded down; never raw bytes.
const FILE_LABEL = /^Artwork file \(up to [\d.,]+ (KB|MB)\)$/;
// The file field's hidden picker input, named apart from the visible field.
const PICKER_LABEL = 'Choose file to attach';

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

        // Network and From sit in the closed From section; Title comes
        // before the file (the standard file field), then Memo.
        const network = screen.getByRole('button', { name: /^Network: Bitcoin/, hidden: true });
        const from = screen.getByLabelText('From address');
        const token = screen.getByRole('button', { name: /^Token: ART on Bitcoin/ });
        const file = screen.getByLabelText(FILE_LABEL);
        const title = screen.getByLabelText('Title');
        const memo = screen.getByLabelText('Memo');

        expect(from).toHaveAttribute('readonly');
        expect(token).toBeDisabled();
        expect(precedes(network, from)).toBe(true);
        expect(precedes(from, token)).toBe(true);
        expect(precedes(token, title)).toBe(true);
        expect(precedes(title, file)).toBe(true);
        expect(precedes(file, memo)).toBe(true);
    });

    it('offers only the token chain on the Network field', async () => {
        mount();
        await composeReady();

        // The token decides the network, so the standard From section
        // shows it locked to the token chain; no other network can be picked.
        openSection('From');
        const network = screen.getByRole('button', { name: /^Network: Bitcoin/ });
        expect(network).toBeDisabled();
        fireEvent.click(network);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByRole('button', { name: /Litecoin|Dogecoin/ })).toBeNull();
    });

    it('seeds From with the owner address even when another address is active', async () => {
        mount(messagingFor({ addresses: [OTHER, OWNER], active: OTHER }));
        await composeReady();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('opens the own-address picker locked to the token chain and shows the owner mismatch for a non-owner pick', async () => {
        mount(messagingFor({ addresses: [OWNER, OTHER] }));
        await composeReady();
        expect(screen.getByRole('button', { name: 'Attach Artwork' })).toBeEnabled();

        openSection('From');
        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        expect(await screen.findByTestId('own-address-picker')).toBeInTheDocument();
        expect(pickerProps.last).toMatchObject({ chainId: CHAIN, lockNetwork: true, walletId: 'wallet-1' });

        fireEvent.click(screen.getByRole('button', { name: 'Pick other address' }));

        await waitFor(() => expect(screen.getByLabelText('From address')).toHaveValue(OTHER.address));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'The selected source address does not own ART. Choose the current owner address.',
        );
        expect(screen.getByRole('button', { name: 'Attach Artwork' })).toBeDisabled();
    });

    it('labels the file chooser with a help tip and keeps only the live limit under it', async () => {
        mount();
        await composeReady();

        // The standard file field carries the live limit in its label
        // ("Artwork file (up to 7.9 KB)"), not in a line under a chooser.
        const limitOf = () => {
            const label = screen.getByText(FILE_LABEL, { selector: 'label' });
            const [, n, unit] = label.textContent.match(/([\d.,]+) (KB|MB)/);
            return Number(n.replace(/,/g, '')) * (unit === 'MB' ? 1024 : 1);
        };
        const before = limitOf();

        // The intro and the static advice live only in the tip now.
        for (const pattern of [/Two signatures: one to upload the file/, /A compact image/]) {
            const matches = screen.queryAllByText(pattern, { ignore: false });
            expect(matches.length).toBeGreaterThan(0);
            for (const node of matches) expect(node.closest('[role="tooltip"]')).not.toBeNull();
        }
        expect(screen.queryByText(/Keep it small/)).toBeNull();
        expect(screen.queryByText(/Store the artwork on the chain itself/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^About Artwork file/ }));
        expect(await screen.findByText(/Two signatures: one to upload the file, one to make it official\. A compact image \(SVG, small PNG\/JPEG\/WebP\) works best\./))
            .toBeInTheDocument();

        // A long title takes room from the file; the 0.1 KB label may round
        // a small change away, so it never grows.
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A gallery title '.repeat(6).trim() } });
        const after = limitOf();
        expect(after).toBeLessThanOrEqual(before);

        const input = screen.getByLabelText(PICKER_LABEL);
        fireEvent.change(input, { target: { files: [new File(['x'], 'art.png', { type: 'image/png' })] } });
        expect(await screen.findByText('art.png')).toBeInTheDocument();
        expect(limitOf()).toBeGreaterThan(0);
        // The standard file field: the picked name in the read-only field,
        // and X in place of Upload at its edge.
        expect(screen.getByLabelText(FILE_LABEL)).toHaveValue('art.png');
        expect(screen.getByLabelText(FILE_LABEL).closest('[data-file-field]')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));
        expect(screen.getByLabelText(FILE_LABEL)).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
    });

    it('shows the Optional pill, help tip and counter on the Title and Memo label lines', async () => {
        mount();
        await composeReady();

        // Title keeps its own Optional pill inside the required
        // Artwork section; Memo is an optional section whose header carries
        // the tag (the Memo field has none of its own), as does the shared
        // Advanced section above Speed and Fees.
        expect(screen.getAllByText('Optional')).toHaveLength(3);
        expect(within(screen.getByRole('button', { name: /^Advanced\b/ })).getByText('Optional')).toBeInTheDocument();
        const titleRow = screen.getByText('Title', { selector: 'label' }).parentElement;
        expect(within(titleRow).getByText('Optional')).toBeInTheDocument();
        expect(within(screen.getByRole('button', { name: /^Memo\b/ })).getByText('Optional')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Token Picture\b/ })).toBeNull();
        expect(screen.queryByText(/\(optional\)/i)).toBeNull();
        expect(screen.getByText('0 / 100')).toBeInTheDocument();
        // The memo's count lives in its section header (hidden while closed),
        // and the lone memo has no label row or tip of its own.
        const memoCount = document.querySelector('[data-form-section="memo"] [data-section-count]');
        expect(memoCount).toHaveTextContent('0 / 250');
        expect(screen.getByRole('button', { name: 'About Title' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'About Memo', hidden: true })).toBeNull();
        expect(screen.getByRole('button', { name: 'About From address', hidden: true })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Network', hidden: true })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Token' })).toBeInTheDocument();
    });

    it('keeps the plain Network fee field and no protocol-fee toggle or Fees card', async () => {
        mount();
        await composeReady();

        // The fee selector sits in the standard Network fee section, closed.
        expect(screen.getByRole('slider', { name: 'Network fee', hidden: true })).toBeInTheDocument();
        // No protocol-fee switch in Speed and Fees; the only switches are the
        // shared Advanced section's, above it.
        const feeSection = document.querySelector('[data-form-section="fee"]');
        expect(within(feeSection).queryByRole('switch', { hidden: true })).toBeNull();
        expect(screen.queryByText(/protocol fee/i)).toBeNull();
        expect(screen.queryByText('Total')).toBeNull();
    });

    it('makes each stage main action green with an icon, and gives every button an icon', async () => {
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
        await composeReady();

        // The action reads "Attach Artwork"; the file is the standard
        // file field (its chooser is the native control, not a form button).
        let form = screen.getByRole('form', { name: 'Attach artwork' });
        expectOneGreenAction(form, 'Attach Artwork');
        expectButtonsHaveIcons(form, ['Attach Artwork']);

        fireEvent.change(screen.getByLabelText(PICKER_LABEL), {
            target: { files: [new File(['x'], 'art.png', { type: 'image/png' })] },
        });
        await screen.findByText('art.png');
        fireEvent.click(screen.getByRole('button', { name: 'Attach Artwork' }));

        form = await screen.findByRole('form', { name: 'Review artwork upload' });
        expectOneGreenAction(form, 'Upload File');
        expectButtonsHaveIcons(form, ['Back', 'Upload File']);
        fireEvent.click(within(form).getByRole('button', { name: 'Upload File' }));
        let approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);

        form = await screen.findByRole('form', { name: 'Review artwork link' });
        expectOneGreenAction(form, 'Link Artwork to ART');
        expectButtonsHaveIcons(form, ['Link Artwork to ART']);
        fireEvent.click(within(form).getByRole('button', { name: 'Link Artwork to ART' }));
        approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);

        // The link is the last signature: no token-info or description step follows.
        const done = await screen.findByRole('button', { name: 'Done' });
        expect(done).toHaveClass(buttonStyles.success);
        expect(done.querySelector('svg')).not.toBeNull();
    }, 30000);
});
