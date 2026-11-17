// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { ListForkRoute as ListForkForm } from '../../helpers/listFormRoutes.jsx';

const CHAIN = 'dogecoin-mainnet';
const ACTIVE = {
    id: 'doge-active',
    address: 'nactiveactiveactiveactiveactiveactive',
    publicKey: '02aa',
    derivationPath: "m/44'/3'/0'/0/0",
    source: 'hd',
    signerId: 'signer-active',
};
const OWNER = {
    id: 'doge-owner',
    address: 'nownerownerownerownerownerownerown',
    publicKey: '02bb',
    derivationPath: "m/44'/3'/0'/0/1",
    source: 'hd',
    signerId: 'signer-owner',
};
const ITEMS = ['KEEP'];

function mountFork(resolution, { owner = ACTIVE.address } = {}) {
    const row = {
        action_index: 2700,
        type: '1',
        source: ACTIVE.address,
        list: ITEMS,
        state: {
            edit_resolution_active: resolution,
            current_list: resolution === false ? null : ITEMS,
            owner,
        },
    };
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode: 'watcher' }], activeWalletId: 'wallet-1' });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ACTIVE, OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ACTIVE.id } }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'W', walletMode: 'watcher' }]),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
        getListByActionIndex: vi.fn().mockResolvedValue(row),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: '70736274ff' }),
    };
    const messaging = new Proxy(target, {
        get(obj, prop) {
            if (prop in obj) return obj[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });

    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListForkForm
                walletId="wallet-1"
                listRef={{
                    chainId: CHAIN,
                    actionIndex: '2700',
                    type: '1',
                    items: ITEMS,
                    editResolutionActive: resolution,
                    source: ACTIVE.address,
                    parentIndex: null,
                }}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

async function publishEdit() {
    fireEvent.change(await screen.findByLabelText('Tokens'), { target: { value: 'ADD' } });
    fireEvent.click(screen.getByRole('button', { name: /^Publish fork$/i }));
    fireEvent.click(await screen.findByTestId('confirm-approve'));
    await screen.findByText('Fork submitted');
}

afterEach(() => {
    cleanup();
    resetWalletModes();
    vi.clearAllMocks();
});

describe('ListForkForm edit presentation', () => {
    it('titles the compose screen Fork list', async () => {
        mountFork(true);
        expect(await screen.findByText('Fork List')).toBeTruthy();
        // The form holds the changes only: no member list, no checkboxes.
        expect(screen.queryByRole('checkbox', { name: 'KEEP' })).toBeNull();
        expect(screen.queryByText('Current members')).toBeNull();
        expect(screen.getByRole('radio', { name: 'Add' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Remove' })).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Tokens' })).toBeTruthy();
        expect(screen.queryByText(/Forking/)).toBeNull();
    });

    it.each([false, null])('shows the repoint rail when resolution is %s', async (resolution) => {
        mountFork(resolution);
        await publishEdit();
        expect(screen.getByText('Edit Published')).toBeTruthy();        expect(screen.getByText('Now referenced by')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Token allow/block lists' })).toBeTruthy();
    });

    it('hides the repoint rail when resolution is true', async () => {
        mountFork(true);
        await publishEdit();
        expect(screen.getByText('Edit Published')).toBeTruthy();        expect(screen.queryByText('Now referenced by')).toBeNull();
        expect(screen.queryByText('Repoint (optional)')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Token allow/block lists' })).toBeNull();
        expect(screen.getByText(/this edit is list #2700.s current membership/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    });

    it('uses state.owner as FROM for a transferred list', async () => {
        const messaging = mountFork(true, { owner: OWNER.address });
        await publishEdit();
        await waitFor(() => expect(messaging.buildActionPsbtRequest).toHaveBeenCalled());
        expect(messaging.buildActionPsbtRequest.mock.calls[0][0].from.address).toBe(OWNER.address);
    });
});
