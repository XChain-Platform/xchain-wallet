// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Create List is one form for every list type: Addresses, Tokens and Union
// in the wallet's themed List type dropdown. Switching type keeps the fields
// the types share (network, From, memo); a token list takes a tickers file
// like an address list takes an addresses file; and the two add-from buttons
// share the one full-width import row.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const formatSupport = vi.hoisted(() => ({
    listFormatSupport: vi.fn(),
    listMetaSupported: vi.fn(),
}));

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => formatSupport);

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId, onPick, onChainChange, onBack }) => (
        <div data-testid="own-picker" data-chain={chainId}>
            <button type="button" onClick={() => onPick({ id: 'second-address' })}>pick second</button>
            <button type="button" onClick={() => onChainChange('litecoin-mainnet')}>switch chain</button>
            <button type="button" onClick={onBack}>picker back</button>
        </div>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const FIRST = { id: 'first-address', address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', publicKey: '02ab', source: 'hd', signerId: 's1' };
const SECOND = { id: 'second-address', address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', publicKey: '02ac', source: 'hd', signerId: 's2' };
const LTC_ADDR = { id: 'ltc-address', address: 'ltc1qg82tqj4lyxj7lkmmhe2mvqpbgwp5mkd4kxfpcc', publicKey: '02ad', source: 'hd', signerId: 's3' };

function mount(props = {}) {
    formatSupport.listFormatSupport.mockResolvedValue({ share: true, transfer: true, union: true });
    formatSupport.listMetaSupported.mockResolvedValue(false);
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [FIRST, SECOND], [LTC]: [LTC_ADDR] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: { id: FIRST.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        isListTickCoinActive: vi.fn().mockResolvedValue(false),
        getListsForSource: vi.fn().mockResolvedValue({ data: [{ action_index: 101, type: 1, members: ['AAA'] }] }),
        getSharedLists: vi.fn().mockResolvedValue({ lists: [], unavailable: [] }),
        getActionFormats: vi.fn().mockResolvedValue({}),
        getTokenInfo: vi.fn().mockResolvedValue(null),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            object[property] = stub;
            return stub;
        },
    });
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListCreateForm walletId="wallet-1" chainId={BTC} onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
    return { messaging, ...view };
}

async function listTypeTrigger() {
    return screen.findByRole('button', { name: /^List type:/ });
}

async function chooseType(label) {
    fireEvent.click(await listTypeTrigger());
    fireEvent.click(screen.getByRole('option', { name: label }));
}

async function openFromPicker() {
    const fromHeader = screen.queryByRole('button', { name: /^From\b/, expanded: false });
    if (fromHeader) fireEvent.click(fromHeader);
    fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
    await screen.findByTestId('own-picker');
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListCreateForm List type', () => {
    it('is the themed dropdown with an icon per type, not a native select', async () => {
        const { container } = mount();
        const trigger = await listTypeTrigger();

        expect(trigger.tagName).toBe('BUTTON');
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(trigger).toHaveAccessibleName('List type: Addresses');
        const field = container.querySelector('[data-list-type-field]');
        expect(field).not.toBeNull();
        expect(field.querySelector('select')).toBeNull();
        expect(screen.queryByRole('combobox', { name: /List type/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'About List type' })).toBeTruthy();

        fireEvent.click(trigger);
        const options = screen.getAllByRole('option');
        expect(options.map((option) => option.textContent)).toEqual(['Addresses', 'Tokens', 'Union']);
        for (const option of options) expect(option.querySelector('svg')).not.toBeNull();
        expect(screen.getByRole('heading', { name: 'Create List' })).toBeTruthy();
    });

    it('opens on Union for the list-union route, still titled Create List', async () => {
        mount({ initialType: '3' });

        expect(await listTypeTrigger()).toHaveAccessibleName('List type: Union');
        expect(await screen.findByRole('checkbox', { name: 'Token list #101' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Create List' })).toBeTruthy();
        expect(screen.queryByLabelText('Addresses')).toBeNull();
    });

    it('shows the union fields on Union and the address fields again on Addresses', async () => {
        mount();
        expect(await screen.findByLabelText('Addresses')).toBeTruthy();

        await chooseType('Union');
        expect(await screen.findByRole('checkbox', { name: 'Token list #101' })).toBeTruthy();
        expect(screen.queryByLabelText('Addresses')).toBeNull();
        expect(screen.getByRole('button', { name: /^Create union list$/i })).toBeTruthy();
        // The switch remounts the body; the type field takes focus back.
        await waitFor(() => expect(document.activeElement).toHaveAccessibleName('List type: Union'));

        await chooseType('Addresses');
        expect(await screen.findByLabelText('Addresses')).toBeTruthy();
        expect(screen.queryByRole('checkbox', { name: 'Token list #101' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Publish List' })).toBeTruthy();
    });

    it('takes focus back to List type only once after a swap, not on a later picker return', async () => {
        mount();
        await screen.findByLabelText('Addresses');
        await chooseType('Union');
        await waitFor(() => expect(document.activeElement).toHaveAccessibleName('List type: Union'));

        await openFromPicker();
        fireEvent.click(screen.getByText('picker back'));
        await screen.findByRole('checkbox', { name: 'Token list #101' });
        expect(document.activeElement).not.toHaveAccessibleName('List type: Union');
    });

    it('keeps the picked From address and the memo across a switch to Union and back', async () => {
        mount();
        await screen.findByLabelText('Addresses');
        await openFromPicker();
        fireEvent.click(screen.getByText('pick second'));
        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(SECOND.address));
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'kept memo' } });

        await chooseType('Union');
        await screen.findByRole('checkbox', { name: 'Token list #101' });
        expect(screen.getByLabelText('From')).toHaveValue(SECOND.address);
        expect(screen.getByLabelText('Memo')).toHaveValue('kept memo');

        await chooseType('Tokens');
        await screen.findByLabelText('Tokens');
        expect(screen.getByLabelText('From')).toHaveValue(SECOND.address);
        expect(screen.getByLabelText('Memo')).toHaveValue('kept memo');
    });

    it('keeps the network across a switch to Union', async () => {
        mount();
        await screen.findByLabelText('Addresses');
        await openFromPicker();
        fireEvent.click(screen.getByText('switch chain'));
        await waitFor(() => expect(screen.getByTestId('own-picker').getAttribute('data-chain')).toBe(LTC));
        fireEvent.click(screen.getByText('picker back'));
        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(LTC_ADDR.address));

        await chooseType('Union');
        await waitFor(() => expect(formatSupport.listFormatSupport).toHaveBeenCalledWith(
            expect.objectContaining({ chainId: LTC }),
        ));
        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(LTC_ADDR.address));
        expect(formatSupport.listFormatSupport).not.toHaveBeenCalledWith(
            expect.objectContaining({ chainId: BTC }),
        );
    });
});

describe('ListCreateForm token list entries', () => {
    it('takes a tickers file for a token list and labels it by type', async () => {
        mount({ initialType: '1' });
        const box = await screen.findByLabelText('Tokens');
        expect(screen.queryByLabelText('Addresses file (CSV or TXT)')).toBeNull();
        fireEvent.change(box, { target: { value: 'TYPED' } });

        fireEvent.change(screen.getByLabelText('Upload tickers file'), {
            target: { files: [new File(['PEPE\nDOGEX, XCAT'], 'tickers.csv', { type: 'text/csv' })] },
        });
        const field = screen.getByLabelText('Tickers file (CSV or TXT)');
        await waitFor(() => expect(field).toHaveValue('tickers.csv'));
        // The file text goes through the same parser as typed tickers.
        expect(box).toHaveValue('TYPED\nPEPE\nDOGEX, XCAT');
        expect(field.closest('[data-file-field]').textContent).toMatch(/Optional/);

        fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));
        expect(box).toHaveValue('TYPED');
        expect(field).toHaveValue('');
    });

    it('gives Add from Token Picker the same full-width row and button style as Add from Contacts', async () => {
        mount({ initialType: '2' });
        const contacts = await screen.findByRole('button', { name: 'Add from Contacts' });
        const contactsRow = contacts.parentElement.className;
        const contactsClass = contacts.className;
        expect(contactsRow).toMatch(/importActions/);

        await chooseType('Tokens');
        const picker = await screen.findByRole('button', { name: 'Add from Token Picker' });
        expect(picker.parentElement.className).toBe(contactsRow);
        expect(picker.parentElement.className).not.toMatch(/fromLine/);
        expect(picker.className).toBe(contactsClass);
    });
});
