// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { ListForkRoute as ListForkForm } from '../../helpers/listFormRoutes.jsx';
import { MigrateToBip39 } from '../../../packages/core/src/shared/routes/MigrateToBip39.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function messagingWith(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getStakesForAddress: vi.fn().mockResolvedValue([]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue([]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getBroadcastsForAddress: vi.fn().mockResolvedValue([]),
        getValidatorsForChain: vi.fn().mockResolvedValue([]),
        getListByActionIndex: vi.fn().mockResolvedValue({
            action_index: '2700', source: ADDRESS.address, list_action_index: null, list: ['XCHAIN'],
        }),
        getTokenInfo: vi.fn().mockResolvedValue(null),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(Component, props, messaging = messagingWith()) {
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Component, props),
    ));
}

describe('primary actions explain missing list and migration input', () => {
    it('ListCreateForm asks for a token', async () => {
        mount(ListCreateForm, {
            walletId: 'wallet-1', chainId: CHAIN, initialType: '1', onBack() {},
        });
        await screen.findByDisplayValue(ADDRESS.address);
        const action = screen.getByRole('button', { name: /^Publish List$/ });

        expect(action).toBeEnabled();
        fireEvent.click(action);

        expect(await screen.findByText('Add at least one token.')).toBeTruthy();
    });

    it('ListForkForm explains that membership has not changed', async () => {
        mount(ListForkForm, {
            walletId: 'wallet-1',
            listRef: {
                chainId: CHAIN,
                actionIndex: '2700',
                type: '1',
                items: ['XCHAIN'],
                source: ADDRESS.address,
                parentIndex: null,
                editResolutionActive: true,
            },
            onBack() {},
            onDone() {},
        });
        await screen.findByLabelText('Tokens');
        const action = screen.getByRole('button', { name: /^Publish fork$/i });

        expect(action).toBeEnabled();
        fireEvent.click(action);

        expect(await screen.findByText('Nothing changed: add or remove an item, or write a memo.')).toBeTruthy();
    });

    it('MigrateToBip39 asks for both password fields', async () => {
        mount(MigrateToBip39, {
            legacyWalletId: 'legacy-wallet', onBack() {},
        });
        const action = screen.getByRole('button', { name: 'Generate Recovery Phrase' });

        expect(action).toBeEnabled();
        fireEvent.click(action);

        expect(await screen.findByText('Enter and confirm a password.')).toBeTruthy();
    });
});
