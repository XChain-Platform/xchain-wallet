// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenPicker } from '../../../packages/core/src/shared/routes/TokenPicker.jsx';

const CHAIN = 'bitcoin-regtest';
const LONG_TICKER = 'ANEXCEPTIONALLYLONGTOKENNAME';

function mountPicker({ messaging: messagingOverrides = {}, ...pickerOverrides } = {}) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: 'bcrt1qholder',
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: LONG_TICKER, quantity: '25', divisibility: 0 }],
                },
            }],
        }),
        ...messagingOverrides,
    };
    const onSelect = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenPicker
                purpose="send"
                walletId="wallet-1"
                onBack={() => {}}
                onSelect={onSelect}
                {...pickerOverrides}
            />
        </MessagingProvider>,
    );
    return { messaging, onSelect };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('<TokenPicker> selection hand-off', () => {
    it('names the selection action and returns the chosen chain and full ticker', async () => {
        const { onSelect } = mountPicker();
        const token = await screen.findByRole('button', {
            // The row label leads with the action and then speaks the balance.
            name: (name) => name.startsWith(`Select ${LONG_TICKER} on Bitcoin · regtest, `),
        });

        fireEvent.click(token);

        expect(onSelect).toHaveBeenCalledOnce();
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN,
            tick: LONG_TICKER,
            kind: 'token',
        }));
    });

    it('restores the rows when the search is cleared', async () => {
        mountPicker();
        await screen.findByText(LONG_TICKER);
        const search = screen.getByRole('searchbox', { name: 'Search coins or tokens' });

        fireEvent.change(search, { target: { value: 'missing' } });
        expect(await screen.findByText('No matching balances')).toBeInTheDocument();

        fireEvent.change(search, { target: { value: '' } });
        await waitFor(() => expect(screen.getByText(LONG_TICKER)).toBeInTheDocument());
        expect(screen.queryByText('No matching balances')).toBeNull();
    });

    it('announces a balance-loading failure without presenting an empty list', async () => {
        mountPicker({
            messaging: {
                getWalletBalances: vi.fn().mockRejectedValue(new Error('Balance service unavailable.')),
            },
        });

        expect(await screen.findByRole('alert')).toHaveTextContent('Balance service unavailable.');
        expect(screen.queryByRole('list', { name: 'Balances' })).toBeNull();
    });
});
