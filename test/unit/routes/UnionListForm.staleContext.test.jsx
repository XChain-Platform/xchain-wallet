// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listFormatSupport = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listFormatSupport,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { UnionListForm } from '../../../packages/core/src/shared/routes/UnionListForm.jsx';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const SOURCE = Object.freeze({
    id: 'source-address',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-source',
});

function deferred() {
    let resolve;
    const promise = new Promise((next) => { resolve = next; });
    return { promise, resolve };
}

function route(messaging, props) {
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <UnionListForm onBack={() => {}} {...props} />
        </MessagingProvider>
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('UnionListForm stale context', () => {
    it('does not show an old wallet list after the wallet changes', async () => {
        listFormatSupport.mockResolvedValue({ union: true });
        const oldLists = deferred();
        const nextAddresses = deferred();
        const messaging = {
            getAddressesByChain: vi.fn((walletId) => (
                walletId === 'wallet-old'
                    ? Promise.resolve({ [BTC]: [SOURCE] })
                    : nextAddresses.promise
            )),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: { id: SOURCE.id } }),
            getSettings: vi.fn().mockResolvedValue({}),
            getListsForSource: vi.fn(() => oldLists.promise),
            getSharedLists: vi.fn().mockResolvedValue({ lists: [] }),
            getActionFormats: vi.fn().mockResolvedValue({}),
        };
        const view = render(route(messaging, {
            walletId: 'wallet-old',
            chainId: BTC,
        }));
        await waitFor(() => expect(messaging.getListsForSource).toHaveBeenCalledOnce());

        view.rerender(route(messaging, {
            walletId: 'wallet-new',
            chainId: BTC,
        }));
        await act(async () => {
            oldLists.resolve({ data: [{ action_index: 101, type: 1, members: ['OLD'] }] });
        });

        expect(screen.queryByRole('checkbox', { name: 'Token list #101' })).toBeNull();
    });

    it('does not show an old network list after the requested network changes', async () => {
        listFormatSupport.mockResolvedValue({ union: true });
        const oldLists = deferred();
        const nextAddresses = deferred();
        let addressRead = 0;
        const messaging = {
            getAddressesByChain: vi.fn(() => {
                addressRead += 1;
                return addressRead === 1
                    ? Promise.resolve({ [BTC]: [SOURCE], [LTC]: [] })
                    : nextAddresses.promise;
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: { id: SOURCE.id } }),
            getSettings: vi.fn().mockResolvedValue({}),
            getListsForSource: vi.fn(() => oldLists.promise),
            getSharedLists: vi.fn().mockResolvedValue({ lists: [] }),
            getActionFormats: vi.fn().mockResolvedValue({}),
        };
        const view = render(route(messaging, {
            walletId: 'wallet-1',
            chainId: BTC,
        }));
        await waitFor(() => expect(messaging.getListsForSource).toHaveBeenCalledOnce());

        view.rerender(route(messaging, {
            walletId: 'wallet-1',
            chainId: LTC,
        }));
        await act(async () => {
            oldLists.resolve({ data: [{ action_index: 202, type: 2, members: ['OLD'] }] });
        });

        expect(screen.queryByRole('checkbox', { name: 'Address list #202' })).toBeNull();
    });
});
