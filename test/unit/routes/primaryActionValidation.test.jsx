// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PlaceOrderPanel } from '../../../packages/core/src/shared/components/PlaceOrderPanel.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { CrossChainSwapForm } from '../../../packages/core/src/shared/routes/CrossChainSwapForm.jsx';
import { SellOwnershipForm } from '../../../packages/core/src/shared/routes/SellOwnershipForm.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const BTC_ADDRESS = Object.freeze({
    id: 'addr-btc',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const LTC_ADDRESS = Object.freeze({
    id: 'addr-ltc',
    address: 'ltc1qexampleexampleexampleexampleexamplex',
    publicKey: '02ddeeff',
    derivationPath: "m/84'/2'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function makeMessaging(addressesByChain) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(addressesByChain),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getNewestAddress: vi.fn().mockResolvedValue(LTC_ADDRESS),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getListsForSource: vi.fn().mockResolvedValue([]),
        searchTokens: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(target, {
        get(object, prop) {
            if (prop in object) return object[prop];
            return vi.fn().mockResolvedValue({ rows: [] });
        },
        has(object, prop) {
            return prop in object;
        },
    });
}

function mount(node, addressesByChain = { [BTC]: [BTC_ADDRESS] }) {
    return render(
        <MessagingProvider shell="web" messaging={makeMessaging(addressesByChain)}>
            {node}
        </MessagingProvider>,
    );
}

async function submitAndExpect(container, message) {
    let submit;
    await waitFor(() => {
        submit = container.querySelector('button[type="submit"]');
        expect(submit).toBeTruthy();
        expect(submit.disabled).toBe(false);
    });
    fireEvent.click(submit);
    await waitFor(() => expect(container.textContent).toContain(message));
}

afterEach(() => {
    __clearTokenInfoCache();
});

describe('primary actions explain missing form input', () => {
    it('PlaceOrderPanel explains that price and size are required', async () => {
        const { container } = mount(
            <PlaceOrderPanel walletId="w" chainId={BTC} tick1="ALPHA" tick2="BETA" />,
        );
        await submitAndExpect(container, 'Price and size are required.');
    });

    it('SwapForm explains that both swap legs are required', async () => {
        const { container } = mount(<SwapForm walletId="w" onBack={() => {}} />);
        await submitAndExpect(container, 'Fill the give/get tickers and amounts before reviewing.');
    });

    it('CrossChainSwapForm explains that both swap legs are required', async () => {
        const { container } = mount(
            <CrossChainSwapForm walletId="w" onBack={() => {}} />,
            { [BTC]: [BTC_ADDRESS], [LTC]: [LTC_ADDRESS] },
        );
        await submitAndExpect(
            container,
            'Fill give/get tickers and amounts (or select ownership) before reviewing.',
        );
    });

    it('SellOwnershipForm explains that its price is required', async () => {
        const { container } = mount(
            <SellOwnershipForm walletId="w" chainId={BTC} tick="ALPHA" onBack={() => {}} />,
        );
        await submitAndExpect(container, 'Enter what you want in return and a price greater than 0.');
    });

    it('AirdropForm explains that its token is required', async () => {
        const { container } = mount(<AirdropForm walletId="w" onBack={() => {}} />);
        await submitAndExpect(container, 'Token is required.');
    });
});
