// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';

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
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher', activeNetwork: 'mainnet' }),
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
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Component {...props} />
        </MessagingProvider>,
    );
}

afterEach(() => {
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
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText('Remove 1 invalid address before reviewing.')).toBeTruthy();
        expect(screen.queryByText('Review list')).toBeNull();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses an action over the compiled carrier limit', async () => {
        mount(ListCreateForm, {
            walletId: 'wallet-1', chainId: DOGE, initialType: '1', onBack() {},
        }, messagingWith(DOGE));
        const ticks = Array.from({ length: 34 }, (_, index) => `${'A'.repeat(247)}${String(index).padStart(3, '0')}`);

        fireEvent.change(await screen.findByLabelText('Tokens (one per line)'), {
            target: { value: ticks.join('\n') },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText(/over the 8,192-byte limit/)).toBeTruthy();
        expect(screen.queryByText('Review list')).toBeNull();
    });
});

describe('list edit validation and review', () => {
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

        const additions = await screen.findByLabelText(/Add tokens/);
        fireEvent.change(additions, { target: { value: 'NEW\nnew\nKEEP\nBAD TICK' } });
        expect(screen.getByText(/1 duplicate removed/).textContent).toMatch(/1 already on the list/);
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText('Remove 1 invalid token name before reviewing.')).toBeTruthy();

        fireEvent.change(additions, { target: { value: 'NEW\nnew\nKEEP' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText('Members after edit')).toBeTruthy();
        expect(screen.getByText('Review added items')).toBeTruthy();
        expect(screen.getByText('NEW')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Create unsigned transaction' }));

        await waitFor(() => expect(messaging.buildActionPsbtRequest).toHaveBeenCalledOnce());
        expect(messaging.buildActionPsbtRequest.mock.calls[0][0].actionData.params).toMatchObject({
            VERSION: '1', EDIT: '1', LIST_ACTION_INDEX: '2700', ITEM: ['NEW'],
        });
    });
});
