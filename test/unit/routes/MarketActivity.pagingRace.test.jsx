// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A Load more click made right after the market changes must survive: the
// page limit resets while rendering, not in a post-paint effect.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketActivity } from '../../../packages/core/src/shared/routes/MarketActivity.jsx';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const offer = (idx) => ({
    action_index: idx, status: 'valid', current_status: 'open', give_tick: 'XCHAIN', get_tick: null,
    get_coin: 'BTC', escrow_remaining: '100', give_amount: '5', get_amount: '0.01',
});
const OFFER_TEXT = '5 XCHAIN per 0.01 BTC';

describe('Marketplace paging', () => {
    it('keeps a load-more click made before the market change effects have flushed', async () => {
        const rows = Array.from({ length: 120 }, (_, index) => offer(String(1000 + index)));
        let answeredChain = null;
        const messaging = {
            getDispensersForToken: vi.fn(({ chainId }) => {
                answeredChain = answeredChain || chainId;
                return Promise.resolve({ data: chainId === answeredChain ? rows : [] });
            }),
            getDispenses: vi.fn().mockResolvedValue({ data: [] }),
            getOrdersForToken: vi.fn().mockResolvedValue({ data: [] }),
            getSwapsForToken: vi.fn().mockResolvedValue({ data: [] }),
            getOrderDetail: vi.fn(async () => null),
            getSwapDetail: vi.fn(async () => null),
            oracleFeeds: vi.fn().mockResolvedValue([]),
        };
        let setWallet;
        function Harness() {
            const [wallet, setWalletState] = React.useState('w1');
            setWallet = setWalletState;
            return React.createElement(
                'div',
                null,
                React.createElement('span', { 'data-testid': 'wallet-scope' }, wallet),
                React.createElement(MarketActivity, { walletId: wallet, onBack() {} }),
            );
        }
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Harness),
        ));
        await screen.findAllByText(OFFER_TEXT);
        expect(screen.getAllByText(OFFER_TEXT)).toHaveLength(50);

        // Outside act React commits the new wallet and defers its passive
        // effects to a later task. Click Load more from the DOM mutation that
        // shows the new wallet, which is before those effects have run.
        const env = globalThis;
        env.IS_REACT_ACT_ENVIRONMENT = false;
        try {
            await new Promise((resolve, reject) => {
                const observer = new MutationObserver(() => {
                    if (screen.getByTestId('wallet-scope').textContent !== 'w2') return;
                    observer.disconnect();
                    try {
                        fireEvent.click(screen.getByRole('button', { name: 'Load more open dispensers' }));
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true, characterData: true });
                setTimeout(() => setWallet('w2'), 0);
            });
        } finally {
            env.IS_REACT_ACT_ENVIRONMENT = true;
        }
        await act(async () => {});
        await screen.findAllByText(OFFER_TEXT);
        expect(screen.getAllByText(OFFER_TEXT)).toHaveLength(100);
    });
});
