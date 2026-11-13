// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Delegate votes only creates a delegation. Clearing one starts from the
// My delegations list (Governance polls plus menu): one read lists the
// address's live delegations, and each row's Clear opens a short clear form
// fixed to that row's address, token and network, with the current
// delegate shown read-only, signing on the shared confirm screen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyDelegations } from '../../../packages/core/src/shared/routes/MyDelegations.jsx';
import { DelegateVoteForm } from '../../../packages/core/src/shared/routes/DelegateVoteForm.jsx';
import { GovernancePolls } from '../../../packages/core/src/shared/routes/GovernancePolls.jsx';
import { voteDelegationsForAddress } from '../../../packages/core/src/flows/voteQueries.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const ACTIVE = Object.freeze({
    id: 'address-1', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
});
const OTHER = Object.freeze({
    id: 'address-2', address: 'bc1q34aq5drpuwy3wgl9lhup9892qp6svr8ldzyy7c', publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/1", source: 'hd', signerId: 'signer-1',
});
const DELEGATE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function delegationRows(count) {
    return Array.from({ length: count }, (_v, i) => ({
        tick: `TOK${i}`, delegator: ACTIVE.address, delegate: DELEGATE,
        block_index: 100 + i, timestamp: 1_700_000_000 + i, action_index: 500 + i,
    }));
}

function messagingWith(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ACTIVE, OTHER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ACTIVE.id } }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        governanceVoteDelegations: vi.fn().mockResolvedValue({ data: delegationRows(1) }),
        governancePolls: vi.fn().mockResolvedValue([]),
        composeVoteForConfirm: vi.fn().mockResolvedValue({ psbt: '00', encoding: 'psbt' }),
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

function mount(Component, props, messaging) {
    render(React.createElement(MessagingProvider, { shell: 'web', messaging }, React.createElement(Component, props)));
}

beforeEach(() => {
    resetBackStackForTests();
    resetWalletModes();
    __clearTokenInfoCache();
    publishWalletModes({ activeWalletId: 'wallet-1' });
});
afterEach(cleanup);

describe('My delegations list', () => {
    it('lists the active address\'s live delegations from one read, each with Clear', async () => {
        const messaging = messagingWith();
        const onClear = vi.fn();
        mount(MyDelegations, { walletId: 'wallet-1', chainId: CHAIN, onClear, onBack() {} }, messaging);

        const list = await screen.findByRole('list', { name: 'My Delegations' });
        expect(within(list).getByText('TOK0')).toBeInTheDocument();
        expect(within(list).getByText(/^To bc1q\.\.\.f3t4 · Since /)).toBeInTheDocument();
        expect(messaging.governanceVoteDelegations).toHaveBeenCalledTimes(1);
        expect(messaging.governanceVoteDelegations).toHaveBeenCalledWith({ chainId: CHAIN, address: ACTIVE.address });

        const clear = within(list).getByRole('button', { name: 'Clear the TOK0 delegation' });
        expect(clear.querySelector('svg')).not.toBeNull();
        fireEvent.click(clear);
        expect(onClear).toHaveBeenCalledWith(CHAIN, { tick: 'TOK0', delegate: DELEGATE, address: ACTIVE.address });
    });

    it('reads once whether the address has one delegation or many', async () => {
        for (const count of [1, 6]) {
            const messaging = messagingWith({
                governanceVoteDelegations: vi.fn().mockResolvedValue({ data: delegationRows(count) }),
            });
            mount(MyDelegations, { walletId: 'wallet-1', chainId: CHAIN, onClear() {}, onBack() {} }, messaging);
            const list = await screen.findByRole('list', { name: 'My Delegations' });
            expect(within(list).getAllByRole('listitem')).toHaveLength(count);
            expect(messaging.governanceVoteDelegations).toHaveBeenCalledTimes(1);
            cleanup();
        }
    });

    it('says when the address has no delegations', async () => {
        const messaging = messagingWith({ governanceVoteDelegations: vi.fn().mockResolvedValue([]) });
        mount(MyDelegations, { walletId: 'wallet-1', chainId: CHAIN, onClear() {}, onBack() {} }, messaging);
        expect(await screen.findByText('No delegations')).toBeInTheDocument();
    });
});

describe('Governance polls plus menu', () => {
    it('offers My delegations beside Create poll and Delegate votes', async () => {
        const onMyDelegations = vi.fn();
        mount(GovernancePolls, {
            walletId: 'wallet-1', onOpenPoll() {}, onCreate() {}, onDelegate() {}, onMyDelegations, onBack() {},
        }, messagingWith());
        fireEvent.click(await screen.findByRole('button', { name: 'New poll or delegation' }));
        const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
        expect(items).toEqual(['Create poll', 'Delegate votes', 'My delegations']);
        fireEvent.click(screen.getByRole('menuitem', { name: 'My delegations' }));
        expect(onMyDelegations).toHaveBeenCalledWith(CHAIN);
    });
});

describe('Delegate votes and the clear form', () => {
    it('Delegate votes only creates a delegation', async () => {
        mount(DelegateVoteForm, { mode: 'delegate', walletId: 'wallet-1', chainId: CHAIN, onBack() {} }, messagingWith());
        expect(await screen.findByRole('button', { name: 'Delegate Votes' })).toBeInTheDocument();
        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.queryByText(/Clear my delegation/i)).toBeNull();
        expect(screen.getByLabelText('Delegate to address')).toBeInTheDocument();
    });

    it('clears from the row\'s own address with the token and delegate read-only', async () => {
        const messaging = messagingWith();
        mount(DelegateVoteForm, {
            mode: 'clear',
            walletId: 'wallet-1',
            chainId: CHAIN,
            clear: { tick: 'TOK0', delegate: DELEGATE, address: OTHER.address },
            onBack() {},
        }, messaging);

        const action = await screen.findByRole('button', { name: 'Clear Delegation' });
        expect(screen.getByDisplayValue(DELEGATE)).toHaveAttribute('readonly');
        expect(screen.queryByLabelText('Delegate to address')).toBeNull();
        // The From address is the row's (not the active one) and has no picker.
        expect(screen.getByDisplayValue(OTHER.address)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Choose source address' })).toBeNull();

        await act(async () => {
            fireEvent.click(action);
            await Promise.resolve();
        });
        expect(messaging.composeVoteForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            builder: 'clearVoteDelegationParams',
            chainId: CHAIN,
            from: expect.objectContaining({ address: OTHER.address }),
            params: { tick: 'TOK0' },
        }));
    });

    it('refuses a clear whose address is not in the wallet', async () => {
        mount(DelegateVoteForm, {
            mode: 'clear',
            walletId: 'wallet-1',
            chainId: CHAIN,
            clear: { tick: 'TOK0', delegate: DELEGATE, address: 'bc1qnotminenotminenotminenotminenotmi' },
            onBack() {},
        }, messagingWith());
        expect(await screen.findByText('This address is not in this wallet on this network.')).toBeInTheDocument();
    });
});

describe('voteDelegationsForAddress', () => {
    it('reads the explorer route once and keeps only live rows for the address', async () => {
        const get = vi.fn().mockResolvedValue({
            data: [
                { tick: 'A', delegator: ACTIVE.address, delegate: DELEGATE },
                { tick: 'B', delegator: ACTIVE.address, delegate: null },
                { tick: 'C', delegator: OTHER.address, delegate: DELEGATE },
            ],
        });
        const sdkRegistry = { get: () => ({ explorer: { get } }) };
        const rows = await voteDelegationsForAddress({ sdkRegistry, chainId: CHAIN, address: ACTIVE.address });
        expect(get).toHaveBeenCalledTimes(1);
        expect(get.mock.calls[0][0]).toBe(`/vote_delegations/${ACTIVE.address}/delegator`);
        expect(rows.map((row) => row.tick)).toEqual(['A']);
    });

    it('prefers the SDK method when it has one', async () => {
        const getVoteDelegations = vi.fn().mockResolvedValue([{ tick: 'A', delegator: ACTIVE.address, delegate: DELEGATE }]);
        const sdkRegistry = { get: () => ({ getVoteDelegations }) };
        await voteDelegationsForAddress({ sdkRegistry, chainId: CHAIN, address: ACTIVE.address });
        expect(getVoteDelegations).toHaveBeenCalledWith(ACTIVE.address, 'delegator', undefined);
    });
});
