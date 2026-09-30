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
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';

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
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ACTIVE, OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ACTIVE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher', activeNetwork: 'mainnet' }),
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
    fireEvent.change(await screen.findByLabelText(/Add tokens/), { target: { value: 'ADD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create unsigned transaction' }));
    await screen.findByText('Fork submitted');
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListForkForm edit presentation', () => {
    it('titles the compose screen Edit list', async () => {
        mountFork(true);
        expect(await screen.findByText('Edit list')).toBeTruthy();
    });

    it.each([false, null])('shows the repoint rail when resolution is %s', async (resolution) => {
        mountFork(resolution);
        await publishEdit();
        expect(screen.getByText('Edit published')).toBeTruthy();
        expect(screen.getByText('Now referenced by')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Token allow/block lists' })).toBeTruthy();
    });

    it('hides the repoint rail when resolution is true', async () => {
        mountFork(true);
        await publishEdit();
        expect(screen.getByText('Edit published')).toBeTruthy();
        expect(screen.queryByText('Now referenced by')).toBeNull();
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
