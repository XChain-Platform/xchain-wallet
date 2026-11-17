// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is also available.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const listFormatSupport = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({ listFormatSupport }));

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ title, chainId, onPick, onChainChange, onBack }) => (
        <div data-testid="own-picker" data-chain={chainId}>
            <h2>{title}</h2>
            <button type="button" onClick={() => onPick({ id: 'second-address' })}>pick second</button>
            <button type="button" onClick={() => onChainChange('litecoin-mainnet')}>switch chain</button>
            <button type="button" onClick={onBack}>picker back</button>
        </div>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';

// Create List opened on the Union type, as the list-union route opens it.
const CreateUnionList = (props) => <ListCreateForm initialType="3" {...props} />;

const CHAIN = 'bitcoin-mainnet';
const FIRST = { id: 'first-address', address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', source: 'hd', signerId: 's1' };
const SECOND = { id: 'second-address', address: 'bc1qsecondaddress000000000000000000000000', source: 'hd', signerId: 's2' };
const LTC_ADDR = { id: 'ltc-address', address: 'ltc1qexampleaddress000000000000000000000000', source: 'hd', signerId: 's3' };

function mount() {
    listFormatSupport.mockResolvedValue({ union: true });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [FIRST, SECOND],
            'litecoin-mainnet': [LTC_ADDR],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: FIRST.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListsForSource: vi.fn().mockResolvedValue({ data: [{ action_index: 101, type: 1, members: ['AAA'] }] }),
        getSharedLists: vi.fn().mockResolvedValue({ lists: [], unavailable: [] }),
        getActionFormats: vi.fn().mockResolvedValue({}),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <CreateUnionList walletId="wallet-1" chainId={CHAIN} onBack={() => {}} onDone={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// From is a closed standard section; open it, then find its picker icon.
async function chooseSourceButton() {
    fireEvent.click(await screen.findByRole('button', { name: /^From\b/, expanded: false }));
    return screen.getByRole('button', { name: 'Choose source address' });
}

describe('ListCreateForm union type: From picker and submit', () => {
    it('gives From a picker icon button that opens the own-address picker on the form network', async () => {
        mount();
        const open = await chooseSourceButton();
        expect((await screen.findByLabelText('From')).value).toBe(FIRST.address);

        fireEvent.click(open);

        const picker = await screen.findByTestId('own-picker');
        expect(picker.getAttribute('data-chain')).toBe(CHAIN);
        expect(screen.getByText('From Address')).toBeTruthy();
    });

    it('returns to the form with the picked address', async () => {
        mount();
        fireEvent.click(await chooseSourceButton());
        fireEvent.click(await screen.findByText('pick second'));

        await waitFor(() => expect(screen.queryByTestId('own-picker')).toBeNull());
        expect(screen.getByLabelText('From').value).toBe(SECOND.address);
    });

    it('switches the form network when the picker switches chain', async () => {
        mount();
        fireEvent.click(await chooseSourceButton());
        fireEvent.click(await screen.findByText('switch chain'));

        await waitFor(() => expect(screen.getByTestId('own-picker').getAttribute('data-chain')).toBe('litecoin-mainnet'));
        fireEvent.click(screen.getByText('picker back'));
        await waitFor(() => expect(screen.getByLabelText('From').value).toBe(LTC_ADDR.address));
    });

    it('submits through a green Create union list button with an icon', async () => {
        mount();
        const submit = await screen.findByRole('button', { name: /^Create union list$/i });
        expect(submit.getAttribute('type')).toBe('submit');
        expect(submit.className).toMatch(/success/);
        expect(submit.querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    });

    it('shows the estimate as a read-only line with no help icon (G121)', async () => {
        mount();
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Token list #101' }));
        expect(screen.getByText('Estimated merged membership: 1')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'About the membership estimate' })).toBeNull();
    });
});
