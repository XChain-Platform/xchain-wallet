// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { CreateBetFeedForm } from '../../../packages/core/src/shared/routes/CreateBetFeedForm.jsx';
import { CreatePollForm } from '../../../packages/core/src/shared/routes/CreatePollForm.jsx';
import { OracleForm } from '../../../packages/core/src/shared/routes/OracleForm.jsx';

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ onPick }) => React.createElement(
        'button',
        { type: 'button', onClick: () => onPick({ id: 'unavailable-address' }) },
        'Pick unavailable address',
    ),
}));

const BTC = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const FEED = Object.freeze({
    action_index: '123',
    source: 'bc1qoracleoracleoracleoracleoracleoraclex',
    label: 'Which side wins?',
    outcomes: 'Yes,No',
    tick: 'XCHAIN',
    deadline: Math.floor(Date.now() / 1000) + 3600,
    expire_at: Math.floor(Date.now() / 1000) + 7200,
    feed_status: 'open',
    pools: [],
    timeline: [],
});

function messagingWith(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getChainTipBlockTime: vi.fn().mockResolvedValue({ blockTime: 0 }),
        betFeed: vi.fn().mockResolvedValue({ data: [FEED] }),
        oracleFeeds: vi.fn().mockResolvedValue([]),
        oracleConsumers: vi.fn().mockResolvedValue({ supported: true, dispensers: [] }),
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

describe('primary actions explain missing form input', () => {
    it('BetFeedDetail asks for an outcome when Review bet is pressed', async () => {
        mount(BetFeedDetail, { walletId: 'wallet-1', chainId: BTC, feedIndex: '123', onBack() {} });
        const action = await screen.findByRole('button', { name: 'Review bet' });

        expect(action).toBeEnabled();
        fireEvent.click(action);

        expect(await screen.findByText('Choose an outcome.')).toBeTruthy();
    });

    it('CreateBetFeedForm explains that the selected chain has no source address', async () => {
        mount(CreateBetFeedForm, {
            walletId: 'wallet-1', chainId: BTC, presetTick: 'XCHAIN', onBack() {},
        });
        await screen.findByDisplayValue(ADDRESS.address);

        fireEvent.click(screen.getByRole('button', { name: 'Choose oracle address' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick unavailable address' }));
        const action = screen.getByRole('button', { name: 'Review market' });
        expect(action).toBeEnabled();
        fireEvent.click(action);

        expect(await screen.findByText('No address on this chain to create a market from.')).toBeTruthy();
    });

    it('CreatePollForm asks for its governance token', async () => {
        mount(CreatePollForm, { walletId: 'wallet-1', chainId: BTC, onBack() {} });
        await screen.findByDisplayValue(ADDRESS.address);
        const action = screen.getByRole('button', { name: 'Create poll' });

        expect(action).toBeEnabled();
        fireEvent.click(action);

        expect(await screen.findByText('Governance token is required.')).toBeTruthy();
    });

    it('OracleForm asks for the token ticker', async () => {
        mount(OracleForm, { walletId: 'wallet-1', initialChainId: BTC, onBack() {} });
        await screen.findByDisplayValue(ADDRESS.address);
        const action = screen.getByRole('button', { name: 'Publish price' });

        expect(action).toBeEnabled();
        fireEvent.click(action);

        expect(await screen.findByText('Enter the token ticker this oracle prices.')).toBeTruthy();
        await waitFor(() => expect(action).toBeEnabled());
    });
});
