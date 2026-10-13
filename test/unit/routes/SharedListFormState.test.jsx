// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listFormatSupport = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listFormatSupport,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SharedListDirectory } from '../../../packages/core/src/shared/routes/SharedListDirectory.jsx';
import { SignerSelectForm } from '../../../packages/core/src/shared/routes/SignerSelectForm.jsx';
import { UnionListForm } from '../../../packages/core/src/shared/routes/UnionListForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'source-address',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-source',
});
const OLD_SIGNER = Object.freeze({
    id: 'signer-old',
    kind: 'ledger',
    vendor: 'Ledger',
    model: 'Nano X',
    label: 'Old signer',
});
const NEW_SIGNER = Object.freeze({
    id: 'signer-new',
    kind: 'trezor',
    vendor: 'Trezor',
    model: 'Safe 5',
    label: 'New signer',
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('shared list route state boundaries', () => {
    it('keeps a load-more click made with a newly entered search', async () => {
        const lists = Array.from({ length: 50 }, (_, index) => ({
            home_chain: 'BTC',
            home_list_index: index + 1,
            type: 1,
            owner: `owner-${index}`,
            member_count: 1,
            share_block: 100 + index,
            bindTarget: 1000 + index,
        }));
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getSharedLists: vi.fn().mockResolvedValue({ lists, unavailable: [] }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SharedListDirectory
                    walletId="wallet-1"
                    chainId={CHAIN}
                    mode="browse"
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        expect(await screen.findAllByRole('listitem')).toHaveLength(20);
        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        expect(screen.getAllByRole('listitem')).toHaveLength(40);

        const loadMore = screen.getByRole('button', { name: 'Load more' });
        await act(async () => {
            fireEvent.change(screen.getByLabelText('Search shared lists'), { target: { value: 'BTC' } });
            fireEvent.click(loadMore);
        });

        expect(screen.getAllByRole('listitem')).toHaveLength(40);
    });

    it('surfaces a synchronous directory failure through the load error', async () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getSharedLists: vi.fn(() => { throw new Error('Directory transport failed'); }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SharedListDirectory
                    walletId="wallet-1"
                    chainId={CHAIN}
                    mode="browse"
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByText('Directory transport failed')).toBeTruthy();
    });

    it('clears union inputs before building another watcher transaction', async () => {
        listFormatSupport.mockResolvedValue({ share: true, transfer: true, union: true });
        const messaging = new Proxy({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
            getListsForSource: vi.fn().mockResolvedValue({
                data: [{ action_index: 101, type: 1, members: ['AAA'] }],
            }),
            getSharedLists: vi.fn().mockResolvedValue({ lists: [], unavailable: [] }),
            getActionFormats: vi.fn().mockResolvedValue({}),
            buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: 'aa00', encoding: 'psbt' }),
        }, {
            get(target, property) {
                if (property in target) return target[property];
                return vi.fn().mockResolvedValue(null);
            },
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <UnionListForm walletId="wallet-1" chainId={CHAIN} onBack={() => {}} />
            </MessagingProvider>,
        );

        fireEvent.click(await screen.findByRole('checkbox', { name: 'Token list #101' }));
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'first list' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create unsigned transaction' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Build another' }));

        expect(screen.getByRole('checkbox', { name: 'Token list #101' })).not.toBeChecked();
        expect(screen.getByLabelText('Memo (optional)')).toHaveValue('');
    });

    it('surfaces a synchronous union address failure through the load error', async () => {
        const messaging = new Proxy({
            getAddressesByChain: vi.fn(() => { throw new Error('Address transport failed'); }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        }, {
            get(target, property) {
                if (property in target) return target[property];
                return vi.fn().mockResolvedValue(null);
            },
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <UnionListForm walletId="wallet-1" chainId={CHAIN} onBack={() => {}} />
            </MessagingProvider>,
        );

        expect(await screen.findByText('Address transport failed')).toBeTruthy();
    });

    it('does not validate a new wallet choice against the previous wallet registry', async () => {
        let resolveNewSigners;
        const newSigners = new Promise((resolve) => { resolveNewSigners = resolve; });
        const listSigners = vi.fn((walletId) => (
            walletId === 'wallet-1' ? Promise.resolve([OLD_SIGNER]) : newSigners
        ));
        const messaging = {
            listSigners,
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        };
        const onChange = vi.fn();
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SignerSelectForm walletId="wallet-1" value="signer-old" onChange={onChange} />
            </MessagingProvider>,
        );
        expect(await screen.findByRole('radio', { name: /Old signer/ })).toBeChecked();
        onChange.mockClear();

        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <SignerSelectForm walletId="wallet-2" value="signer-new" onChange={onChange} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(listSigners).toHaveBeenCalledWith('wallet-2'));
        expect(onChange).not.toHaveBeenCalled();

        await act(async () => { resolveNewSigners([NEW_SIGNER]); });
        expect(await screen.findByRole('radio', { name: /New signer/ })).toBeChecked();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('surfaces a synchronous signer registry failure without escaping the effect', async () => {
        const messaging = {
            listSigners: vi.fn(() => { throw new Error('Signer transport failed'); }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SignerSelectForm walletId="wallet-1" value={null} onChange={() => {}} />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('alert')).toHaveTextContent('Signer transport failed');
    });
});
