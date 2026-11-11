// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const listFormatSupport = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listFormatSupport,
}));

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ title, chainId, lockNetwork, onPick }) => (
        <section aria-label={title} data-chain-id={chainId} data-lock-network={String(lockNetwork)}>
            <button
                type="button"
                onClick={() => onPick({
                    id: 'other-address',
                    address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
                    source: 'hd',
                })}
            >
                Pick non-owner
            </button>
        </section>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListShareForm } from '../../../packages/core/src/shared/routes/ListShareForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const OWNER_RECORD = {
    id: 'owner-address', address: OWNER, source: 'hd', publicKey: '02aa', signerId: 'owner-signer',
};
const OTHER_RECORD = {
    id: 'other-address', address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', source: 'hd', publicKey: '02bb', signerId: 'other-signer',
};

function messaging() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER_RECORD, OTHER_RECORD] }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getListByActionIndex: vi.fn().mockResolvedValue({
            action_index: 2700,
            type: 2,
            source: OWNER,
            list: ['bc1qmember'],
            state: { owner: OWNER, current_list: ['bc1qmember'] },
        }),
        getSharedLists: vi.fn().mockResolvedValue({ lists: [] }),
        getActionFormats: vi.fn().mockResolvedValue({ 2: 'VERSION|LIST_ACTION_INDEX|MEMO' }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function expectBefore(first, second) {
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListShareForm screen rules', () => {
    it('starts with locked Network and From fields and uses the named success action', async () => {
        listFormatSupport.mockResolvedValue({ share: true, transfer: true, union: true });
        render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <ListShareForm
                    walletId="wallet-1"
                    listRef={{ chainId: CHAIN, actionIndex: '2700' }}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        const network = await screen.findByRole('button', { name: /^Network:/ });
        const from = screen.getByLabelText('From');
        const list = screen.getByText('#2700');
        expectBefore(network, from);
        expectBefore(from, list);
        expect(from).toHaveValue(OWNER);

        const submit = screen.getByRole('button', { name: 'Share list' });
        expect(submit).toHaveClass(buttonStyles.success);
        expect(submit.querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'About From' }));
        expect(screen.getByText(/Only this list's owner can share it/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'About Memo' }));
        expect(screen.getByText('A note recorded with this permanent list share.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        const picker = screen.getByRole('region', { name: 'From address' });
        expect(picker).toHaveAttribute('data-chain-id', CHAIN);
        expect(picker).toHaveAttribute('data-lock-network', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Pick non-owner' }));

        expect(await screen.findByText(/A share signed by another address will be refused by the network/)).toBeTruthy();
        expect(screen.getByLabelText('From')).toHaveValue(OTHER_RECORD.address);
        expect(screen.getByRole('button', { name: 'Share list' })).toBeDisabled();
    });
});
