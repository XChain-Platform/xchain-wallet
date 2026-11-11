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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const listMetaSupported = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({ listMetaSupported }));

const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const OTHER = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId, onPick, lockNetwork, title }) => (
        <section data-testid="own-address-picker" data-chain-id={chainId} data-lock={String(Boolean(lockNetwork))}>
            <h2>{title}</h2>
            <button type="button" onClick={() => onPick({ id: 'other-address', address: OTHER })}>Pick other</button>
        </section>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListRenameForm } from '../../../packages/core/src/shared/routes/ListRenameForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER_RECORD = { id: 'owner-address', address: OWNER, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's1' };
const OTHER_RECORD = { id: 'other-address', address: OTHER, publicKey: '02bb', derivationPath: "m/84'/0'/0'/0/1", source: 'hd', signerId: 's2' };

function mount({ shared = { lists: [] }, walletMode = 'full' } = {}) {
    listMetaSupported.mockResolvedValue(true);
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OTHER_RECORD, OWNER_RECORD] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OTHER_RECORD.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockResolvedValue({
            action_index: 2700, type: 2, source: OWNER, list_action_index: null,
            name: 'Old name', description: 'Old description', list: ['bc1qmember'],
            state: { owner: OWNER, edit_resolution_active: true, current_list: ['bc1qmember'] },
        }),
        getSharedLists: vi.fn().mockResolvedValue(shared),
        getActionFormats: vi.fn().mockResolvedValue({}),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListRenameForm walletId="wallet-1" listRef={{ chainId: CHAIN, actionIndex: '2700' }} onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListRenameForm submit button', () => {
    it('shows the Rename list action as a green submit with an icon', async () => {
        mount();
        const submit = await screen.findByRole('button', { name: 'Rename list' });
        await waitFor(() => expect(submit).toBeEnabled());
        expect(submit).toHaveAttribute('type', 'submit');
        expect(submit.querySelector('svg')).not.toBeNull();
        expect(submit.className).toMatch(/success/);
        expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    });

    it('keeps the Create unsigned transaction label with an icon in watcher mode', async () => {
        mount({ walletMode: 'watcher' });
        const submit = await screen.findByRole('button', { name: 'Create unsigned transaction' });
        expect(submit.querySelector('svg')).not.toBeNull();
        expect(submit.className).toMatch(/success/);
        expect(screen.queryByRole('button', { name: 'Rename list' })).toBeNull();
    });
});
