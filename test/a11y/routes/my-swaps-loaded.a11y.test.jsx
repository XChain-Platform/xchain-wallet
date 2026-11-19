// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// My Swaps and Swap Details with data on screen: the one list of row
// buttons with status chips, and the details page's facts, transaction
// copy and explorer link, activity and Edit and Cancel. The route sweep
// (m-z-routes) only sees their loading states.

import React from 'react';
import { afterEach, describe, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MySwapsView } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';
import { SwapDetail } from '../../../packages/core/src/shared/routes/SwapDetail.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const OWNER = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

function swap(actionIndex, swapStatus) {
    return {
        action: 'SWAP', action_index: String(actionIndex), source: OWN,
        give_tick: 'DOGESWAP', give_coin: 'DOGE', give_amount: '500', give_ownership: 0,
        get_tick: null, get_coin: 'DOGE', get_amount: '10.5', get_ownership: 0,
        expiration: FUTURE, block_index: '67882087', tx_hash: 'e'.repeat(64),
        status: 'valid', swap_status: swapStatus,
    };
}

function messaging() {
    const target = {
        getAddressesByChain: async () => ({ [CHAIN]: [OWNER] }),
        getSwapsForAddress: async () => ({ data: [swap(812, 'open'), swap(811, 'complete')] }),
        getSwapCancelsForAddress: async () => ({ data: [] }),
        getSwapDetail: async () => ({ ...swap(812, 'open'), state: { status: 'open', expiration: FUTURE } }),
        getSwapLifecycle: async () => ({ data: [] }),
        getSignerStatus: async () => ({ status: 'locked' }),
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return async () => ({});
        },
    });
}

async function mount(element) {
    let utils;
    await act(async () => {
        utils = render(<MessagingProvider shell="web" messaging={messaging()}>{element}</MessagingProvider>);
        for (let i = 0; i < 40; i += 1) await Promise.resolve();
    });
    return utils;
}

afterEach(() => cleanup());

describe('My Swaps with data has no serious axe violations', () => {
    it('the one swap list', async () => {
        const { container, getByRole } = await mount(
            <MySwapsView walletId="w" onBack={() => {}} onOpenSwap={() => {}} />,
        );
        getByRole('list', { name: 'Swaps' });
        await expectNoSeriousAxeViolations(container);
    });

    it('an open swap on its details page', async () => {
        const { container, getByRole } = await mount(
            <SwapDetail walletId="w" chainId={CHAIN} actionIndex="812" onBack={() => {}} />,
        );
        // The Actions tab's Cancel swap row (G101), then the Details tab.
        getByRole('button', { name: /^Cancel swap/ });
        await expectNoSeriousAxeViolations(container);
        fireEvent.click(getByRole('tab', { name: 'Details' }));
        await expectNoSeriousAxeViolations(container);
    });
});
