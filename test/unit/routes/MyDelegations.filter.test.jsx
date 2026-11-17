// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// My delegations is a standard list page: the body is only the list, the
// title bar holds the Filter (search over token and delegate, plus the
// Delegating address) left of the Delegate votes plus, and each row's X
// opens the clear form for that row.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyDelegations } from '../../../packages/core/src/shared/routes/MyDelegations.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

const CHAIN = 'bitcoin-mainnet';
const ACTIVE = Object.freeze({
    id: 'address-1', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
});
const OTHER = Object.freeze({
    id: 'address-2', address: 'bc1q34aq5drpuwy3wgl9lhup9892qp6svr8ldzyy7c', publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/1", source: 'hd', signerId: 'signer-1',
});
const DELEGATE_A = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const DELEGATE_B = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

// The picker is its own screen with its own tests; here it only needs to
// hand back the second address.
vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ title, onPick }) => (
        <div data-testid="own-address-picker">
            <h1>{title}</h1>
            <button type="button" onClick={() => onPick({ id: 'address-2', address: 'bc1q34aq5drpuwy3wgl9lhup9892qp6svr8ldzyy7c' })}>
                Pick the second address
            </button>
        </div>
    ),
}));

const ROWS = [
    { tick: 'PEPE', delegator: ACTIVE.address, delegate: DELEGATE_A, block_index: 100, timestamp: 1_700_000_000, action_index: 500 },
    { tick: 'XCP', delegator: ACTIVE.address, delegate: DELEGATE_B, block_index: 101, timestamp: 1_700_000_100, action_index: 501 },
];

function messagingWith(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ACTIVE, OTHER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ACTIVE.id } }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        governanceVoteDelegations: vi.fn().mockResolvedValue({ data: ROWS }),
        ...overrides,
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string' || property === 'then') return undefined;
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(props, messaging) {
    render(React.createElement(MessagingProvider, { shell: 'web', messaging }, React.createElement(MyDelegations, {
        walletId: 'wallet-1', chainId: CHAIN, onClear() {}, onBack() {}, ...props,
    })));
}

function openFilter() {
    fireEvent.click(screen.getByRole('button', { name: 'Filter delegations' }));
    return screen.getByRole('dialog', { name: 'Filter delegations' });
}

beforeEach(() => {
    resetBackStackForTests();
    resetWalletModes();
    publishWalletModes({ activeWalletId: 'wallet-1' });
});
afterEach(cleanup);

describe('My delegations list page', () => {
    it('puts the Filter button left of the Delegate votes plus, with no address field on the page', async () => {
        const onDelegate = vi.fn();
        mount({ onDelegate }, messagingWith());
        await screen.findByRole('list', { name: 'My Delegations' });

        const filter = screen.getByRole('button', { name: 'Filter delegations' });
        const plus = screen.getByRole('button', { name: 'Delegate votes' });
        expect(filter.querySelector('svg')).not.toBeNull();
        expect(plus.querySelector('svg')).not.toBeNull();
        expect(filter.textContent).toBe('');
        expect(plus.textContent).toBe('');
        // Document order is left to right in the title bar.
        expect(filter.compareDocumentPosition(plus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // The Delegating address lives in the filter, not at the top of the page.
        expect(screen.queryByLabelText('Delegating address')).toBeNull();

        fireEvent.click(plus);
        expect(onDelegate).toHaveBeenCalledWith(CHAIN);
    });

    it('narrows the rows by token and by delegate from the filter search', async () => {
        mount({}, messagingWith());
        const list = await screen.findByRole('list', { name: 'My Delegations' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(2);

        const panel = openFilter();
        const search = within(panel).getByRole('searchbox', { name: 'Search delegations by token or delegate' });
        fireEvent.change(search, { target: { value: 'xcp' } });
        expect(within(screen.getByRole('list', { name: 'My Delegations' })).getAllByRole('listitem')).toHaveLength(1);
        expect(screen.getByText('XCP')).toBeInTheDocument();
        expect(screen.queryByText('PEPE')).toBeNull();

        fireEvent.change(search, { target: { value: DELEGATE_A.slice(0, 12) } });
        expect(screen.getByText('PEPE')).toBeInTheDocument();
        expect(screen.queryByText('XCP')).toBeNull();

        fireEvent.change(search, { target: { value: 'nothing-matches' } });
        expect(screen.queryByRole('list', { name: 'My Delegations' })).toBeNull();
        expect(screen.getByText('No matching delegations')).toBeInTheDocument();
        expect(screen.queryByText('No delegations')).toBeNull();
    });

    it('keeps the filter to a search box and reads the active address once (operator 2026-11-13)', async () => {
        const messaging = messagingWith();
        mount({}, messaging);
        await screen.findByRole('list', { name: 'My Delegations' });
        expect(messaging.governanceVoteDelegations).toHaveBeenCalledTimes(1);
        expect(messaging.governanceVoteDelegations).toHaveBeenLastCalledWith({ chainId: CHAIN, address: ACTIVE.address });

        const panel = openFilter();
        expect(within(panel).queryByLabelText('Delegating address')).toBeNull();
        expect(within(panel).queryByRole('button', { name: 'Choose address' })).toBeNull();
        expect(panel.querySelectorAll('input, select, textarea')).toHaveLength(1);
    });

    it('makes each whole row, with a chevron and no ✕, open the clear form for that row', async () => {
        const onClear = vi.fn();
        mount({ onClear }, messagingWith());
        const list = await screen.findByRole('list', { name: 'My Delegations' });

        const row = within(list).getByRole('button', { name: /^XCP\b/ });
        expect(row.querySelector('svg')).not.toBeNull();
        expect(within(list).queryByRole('button', { name: /^Clear the / })).toBeNull();
        expect(within(list).queryByText('Clear')).toBeNull();
        fireEvent.click(row);
        expect(onClear).toHaveBeenCalledTimes(1);
        expect(onClear).toHaveBeenCalledWith(CHAIN, { tick: 'XCP', delegate: DELEGATE_B, address: ACTIVE.address });
    });
});
