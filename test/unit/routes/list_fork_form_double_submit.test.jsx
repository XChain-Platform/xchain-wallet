// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';

const CHAIN = 'dogecoin-mainnet';
const ADDRESS = {
    id: 'doge-0',
    address: 'DExampleExampleExampleExampleExample',
    publicKey: '02aa',
    derivationPath: "m/44'/3'/0'/0/0",
    source: 'hd',
};
const CURRENT_ITEMS = ['DOGESWAP', 'SWAPTEST'];
const CURRENT_ROW = {
    action_index: 2700,
    type: '1',
    source: ADDRESS.address,
    list: CURRENT_ITEMS,
    state: { edit_resolution_active: true, current_list: CURRENT_ITEMS },
};

function mountFork() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getListByActionIndex: vi.fn().mockResolvedValue(CURRENT_ROW),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: '70736274ff' }),
    };
    const messaging = new Proxy(target, {
        get(obj, prop) {
            if (prop in obj) return obj[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });

    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(ListForkForm, {
            walletId: 'wallet-1',
            listRef: {
                chainId: CHAIN,
                actionIndex: '2700',
                type: '1',
                items: CURRENT_ITEMS,
                editResolutionActive: true,
                source: ADDRESS.address,
                parentIndex: null,
            },
            onBack() {},
            onDone() {},
        }),
    ));
    return messaging;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListForkForm first-leg submission', () => {
    it('starts one compose when two rapid clicks wait on the membership check', async () => {
        const messaging = mountFork();
        await screen.findByText(/Forking token list #2700/);
        fireEvent.change(screen.getByLabelText(/Add tokens/), { target: { value: 'NEWTICK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        const submit = await screen.findByRole('button', { name: 'Create unsigned transaction' });
        let releaseMembership;
        const membership = new Promise((resolve) => { releaseMembership = resolve; });
        messaging.getListByActionIndex.mockImplementation(() => membership);

        act(() => {
            submit.click();
            submit.click();
        });
        expect(submit).toBeDisabled();
        expect(submit).toHaveAttribute('aria-busy', 'true');
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();

        await act(async () => { releaseMembership(CURRENT_ROW); });
        await waitFor(() => expect(messaging.buildActionPsbtRequest).toHaveBeenCalledTimes(1));
    });
});
