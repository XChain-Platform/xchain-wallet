// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { typeCustomRate } from '../../helpers/customNetworkFee.js';
import { ListForkRoute as ListForkForm } from '../../helpers/listFormRoutes.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const ADDRESS = {
    id: 'source-1',
    address: '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs',
    publicKey: `02${'ab'.repeat(32)}`,
    derivationPath: "m/44'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function messagingWith(chainId, overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [chainId]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [chainId]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
        getTokenInfo: vi.fn().mockResolvedValue(null),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: '70736274ff' }),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(Component, props, messaging) {
    // Wallet mode is a property of the wallet record: this is a watch-only wallet.
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode: 'watcher' }], activeWalletId: 'wallet-1' });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Component {...props} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    resetWalletModes();
    cleanup();
    vi.clearAllMocks();
});

describe('list create validation', () => {
    it('does not silently omit an invalid address at review', async () => {
        const messaging = messagingWith(BTC);
        mount(ListCreateForm, {
            walletId: 'wallet-1', chainId: BTC, initialType: '2', onBack() {},
        }, messaging);

        fireEvent.change(await screen.findByLabelText('Addresses'), {
            target: { value: `${ADDRESS.address}\nnot-an-address` },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create Unsigned Transaction' }));

        expect(await screen.findByText('Remove 1 invalid address before reviewing.')).toBeTruthy();
        expect(screen.queryByText('Review List')).toBeNull();        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses an action over the compiled carrier limit', async () => {
        mount(ListCreateForm, {
            walletId: 'wallet-1', chainId: DOGE, initialType: '1', onBack() {},
        }, messagingWith(DOGE));
        const ticks = Array.from({ length: 34 }, (_, index) => `${'A'.repeat(247)}${String(index).padStart(3, '0')}`);

        fireEvent.change(await screen.findByLabelText('Tokens'), {
            target: { value: ticks.join('\n') },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create Unsigned Transaction' }));

        expect(await screen.findByText(/This list has 34 tokens \(8,\d{3} bytes\), but one action holds 8,192 bytes, which fits 32 of them\. Remove 2 tokens\./)).toBeTruthy();
        expect(screen.queryByText('Review List')).toBeNull();    });

    it('refuses a custom fee rate with more than eight decimal places before review', async () => {
        const messaging = messagingWith(BTC);
        mount(ListCreateForm, {
            walletId: 'wallet-1', chainId: BTC, initialType: '1', onBack() {},
        }, messaging);

        fireEvent.change(await screen.findByLabelText('Tokens'), {
            target: { value: 'XCHAIN' },
        });
        // The speed picker sits in the closed Network fee section; open it first.
        fireEvent.click(screen.getByRole('button', { name: /^Speed and Fees\b/, expanded: false }));
        await typeCustomRate('50000');
        fireEvent.click(screen.getByRole('button', { name: 'Create Unsigned Transaction' }));

        expect(await screen.findAllByText('Enter a rate no higher than 1,000 sat/vB.')).toHaveLength(1);
        expect(screen.queryByText('Review List')).toBeNull();        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('keeps form values when Reject leaves confirmation', async () => {
        const messaging = messagingWith(BTC);
        mount(ListCreateForm, {
            walletId: 'wallet-1', chainId: BTC, initialType: '1', onBack() {},
        }, messaging);

        fireEvent.change(await screen.findByLabelText('Tokens'), {
            target: { value: 'XCHAIN' },
        });
        fireEvent.change(screen.getByLabelText('Memo'), {
            target: { value: 'season two' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create Unsigned Transaction' }));

        expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent('Create token list of 1 item');
        expect(screen.getByTestId('confirm-approve')).toHaveAccessibleName('Approve');
        fireEvent.click(screen.getByTestId('confirm-reject'));
        expect(await screen.findByLabelText('Tokens')).toHaveValue('XCHAIN');
        expect(screen.getByLabelText('Memo')).toHaveValue('season two');
        expect(screen.queryByTestId('confirm-modal')).toBeNull();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });
});

describe('list edit validation and review', () => {
    function mountTokenEdit(actionIndex = '2700') {
        const row = {
            action_index: 2700,
            source: ADDRESS.address,
            type: '1',
            list: ['KEEP'],
            state: { edit_resolution_active: true, current_list: ['KEEP'], owner: ADDRESS.address },
        };
        const messaging = messagingWith(BTC, {
            getListByActionIndex: vi.fn().mockResolvedValue(row),
        });
        mount(ListForkForm, {
            walletId: 'wallet-1',
            listRef: {
                chainId: BTC,
                actionIndex,
                type: '1',
                items: ['KEEP'],
                editResolutionActive: true,
                source: ADDRESS.address,
                parentIndex: null,
            },
            onBack() {},
            onDone() {},
        }, messaging);
        return messaging;
    }

    it('refuses a malformed list reference before review', async () => {
        const messaging = mountTokenEdit('-1');
        fireEvent.change(await screen.findByLabelText('Tokens'), { target: { value: 'ADD' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish Fork' }));

        expect(await screen.findByText('List reference must be a positive whole number.')).toBeTruthy();
        expect(screen.queryByText('Review List Edit')).toBeNull();        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('shows plain copy and stays on the form when the list freshness read fails', async () => {
        const messaging = mountTokenEdit();
        fireEvent.change(await screen.findByLabelText('Tokens'), { target: { value: 'ADD' } });
        messaging.getListByActionIndex.mockRejectedValue(Object.assign(
            new Error('Explorer returned HTTP 502 for /BTC/api/lists/2700'),
            { name: 'SDKExplorerError' },
        ));
        fireEvent.click(screen.getByRole('button', { name: 'Publish Fork' }));

        expect(await screen.findByText(/service that reads the chain is temporarily unavailable/)).toBeTruthy();
        expect(screen.queryByText(/\/BTC\/api\/lists/)).toBeNull();
        expect(screen.queryByText('Review List Edit')).toBeNull();    });

    it('keeps form values when Reject leaves confirmation', async () => {
        const messaging = mountTokenEdit();
        fireEvent.change(await screen.findByLabelText('Tokens'), { target: { value: 'ADD' } });
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'season two' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish Fork' }));

        expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent('Add 1 item to list #2700');
        expect(screen.getByTestId('confirm-approve')).toHaveAccessibleName('Approve');
        fireEvent.click(screen.getByTestId('confirm-reject'));
        expect(await screen.findByLabelText('Tokens')).toHaveValue('ADD');
        expect(screen.getByLabelText('Memo')).toHaveValue('season two');
        expect(screen.getByRole('button', { name: 'Publish Fork' })).toBeTruthy();
        expect(screen.queryByTestId('confirm-modal')).toBeNull();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses an empty custom fee rate before review', async () => {
        const messaging = mountTokenEdit();

        fireEvent.change(await screen.findByLabelText('Tokens'), { target: { value: 'NEW' } });
        // The speed picker sits in the closed Network fee section; open it first.
        fireEvent.click(screen.getByRole('button', { name: /^Speed and Fees\b/, expanded: false }));
        await typeCustomRate('');
        fireEvent.click(screen.getByRole('button', { name: 'Publish Fork' }));

        expect(await screen.findAllByText('Enter a custom network fee.')).toHaveLength(1);
        expect(screen.queryByText('Review List Edit')).toBeNull();        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    function mountRemoveList() {
        const row = {
            action_index: 2700,
            source: ADDRESS.address,
            type: '1',
            list: ['KEEP', 'DROPME'],
            state: { edit_resolution_active: true, current_list: ['KEEP', 'DROPME'], owner: ADDRESS.address },
        };
        const messaging = messagingWith(DOGE, {
            getListByActionIndex: vi.fn().mockResolvedValue(row),
        });
        mount(ListForkForm, {
            walletId: 'wallet-1',
            listRef: {
                chainId: DOGE,
                actionIndex: '2700',
                type: '1',
                items: ['KEEP', 'DROPME'],
                editResolutionActive: true,
                source: ADDRESS.address,
                parentIndex: null,
            },
            onBack() {},
            onDone() {},
        }, messaging);
        return messaging;
    }

    it('has no Current members section; removals are entered in the Remove field and sent as a remove edit', async () => {
        const messaging = mountRemoveList();
        fireEvent.click(await screen.findByRole('radio', { name: 'Remove' }));
        const remove = await screen.findByLabelText('Tokens');
        expect(screen.queryByText('Current members')).toBeNull();
        expect(screen.queryByRole('checkbox')).toBeNull();
        expect(screen.queryByText(/Forking/)).toBeNull();
        expect(screen.queryByLabelText('Add tokens')).toBeNull();
        expect(screen.getByRole('button', { name: /About Tokens/i })).toBeTruthy();
        fireEvent.change(remove, { target: { value: 'dropme' } });
        expect(screen.getByText(/1 to remove/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Publish Fork' }));
        expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent('Remove 1 item from list #2700');
        expect(await screen.findByText('Members after edit')).toBeTruthy();
        expect(screen.getByText('Removing')).toBeTruthy();
        expect(screen.getByTestId('confirm-reject')).toHaveAccessibleName('Reject');
        fireEvent.click(screen.getByTestId('confirm-approve'));
        await waitFor(() => expect(messaging.buildActionPsbtRequest).toHaveBeenCalledOnce());
        expect(messaging.buildActionPsbtRequest.mock.calls[0][0].actionData.params).toMatchObject({
            VERSION: '1', EDIT: '2', LIST_ACTION_INDEX: '2700', ITEM: ['DROPME'],
        });
    });

    it('refuses an entry to remove that is not on the list with a field error', async () => {
        const messaging = mountRemoveList();
        fireEvent.click(await screen.findByRole('radio', { name: 'Remove' }));
        const remove = await screen.findByLabelText('Tokens');
        fireEvent.change(remove, { target: { value: 'DROPME, STRANGER' } });
        expect((await screen.findAllByText(/Not on list #2700, so it cannot be removed: STRANGER\./)).length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Publish Fork' }));
        await waitFor(() => expect(screen.queryByText('Members after edit')).toBeNull());
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('validates additions, reports duplicates, previews the delta, and preserves current members', async () => {
        const row = {
            action_index: 2700,
            source: ADDRESS.address,
            type: '1',
            list: ['KEEP'],
            state: { edit_resolution_active: true, current_list: ['KEEP'], owner: ADDRESS.address },
        };
        const messaging = messagingWith(DOGE, {
            getListByActionIndex: vi.fn().mockResolvedValue(row),
        });
        mount(ListForkForm, {
            walletId: 'wallet-1',
            listRef: {
                chainId: DOGE,
                actionIndex: '2700',
                type: '1',
                items: ['KEEP'],
                editResolutionActive: true,
                source: ADDRESS.address,
                parentIndex: null,
            },
            onBack() {},
            onDone() {},
        }, messaging);

        const additions = await screen.findByLabelText('Tokens');
        fireEvent.change(additions, { target: { value: 'NEW\nnew\nKEEP\nBAD TICK' } });
        expect(screen.getByText(/1 duplicate removed/).textContent).toMatch(/1 already on the list/);
        fireEvent.click(screen.getByRole('button', { name: 'Publish Fork' }));
        expect(await screen.findByText('Remove 1 invalid token name before reviewing.')).toBeTruthy();

        fireEvent.change(additions, { target: { value: 'NEW\nnew\nKEEP' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish Fork' }));
        expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent('Add 1 item to list #2700');
        expect(await screen.findByText('Members after edit')).toBeTruthy();
        expect(screen.getByText('Adding')).toBeTruthy();
        expect(screen.getByText('NEW')).toBeTruthy();
        expect(screen.getByTestId('confirm-reject')).toHaveAccessibleName('Reject');
        fireEvent.click(screen.getByTestId('confirm-approve'));

        await waitFor(() => expect(messaging.buildActionPsbtRequest).toHaveBeenCalledOnce());
        expect(messaging.buildActionPsbtRequest.mock.calls[0][0].actionData.params).toMatchObject({
            VERSION: '1', EDIT: '1', LIST_ACTION_INDEX: '2700', ITEM: ['NEW'],
        });
    });
});
