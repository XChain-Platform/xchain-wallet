// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Regression suite: demo wallet amount semantics.
//
//   [P1] 2026-10-13: Demo History keeps coin amounts in human units with
//        wallet-relative signs, and demo fiat totals apply asset divisibility.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
    synthesizeDemoBalances,
} from '../../packages/core/src/flows/demoFixtures.js';
import {
    clearDemoWalletId,
    markDemoWallet,
} from '../../packages/core/src/flows/demoMode.js';
import { defaultRegistry } from '../../packages/core/src/registry/index.js';
import {
    buildBalanceRows,
} from '../../packages/core/src/shared/components/BalanceList.jsx';
import { TotalBalanceHero } from '../../packages/core/src/shared/components/TotalBalanceHero.jsx';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../packages/core/src/shared/routes/History.jsx';

const WALLET_ID = 'demo-wallet-amount-regression';
const ACCOUNT_ID = 'demo-account';
const CHAIN_ID = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qdemowalletamountregression000000000000000';

function messaging(overrides = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{ address: ADDRESS, label: 'Demo address' }],
        }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
}

function mountHistory() {
    const client = messaging();
    render(
        <MessagingProvider shell="web" messaging={client}>
            <History walletId={WALLET_ID} accountId={ACCOUNT_ID} />
        </MessagingProvider>,
    );
    return client;
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    window.localStorage.clear();
});

describe('demo wallet amount regression', () => {
    it('[REGRESSION P1] renders the pending demo send as a small outgoing BTC amount in its row and detail', async () => {
        markDemoWallet(WALLET_ID);
        mountHistory();

        const amount = await waitFor(() => {
            const node = document.querySelector('[data-pending-amount]');
            expect(node).toBeTruthy();
            return node;
        });
        expect(amount).toHaveTextContent('sending -0.05 BTC');
        expect(amount).toHaveAttribute('data-pending-amount', 'out');
        expect(document.body).not.toHaveTextContent('+10,000,000,000 BTC');

        fireEvent.click(amount.closest('button[data-history-row]'));
        const detail = await screen.findByRole('region', { name: 'Action detail' });
        expect(within(detail).getByText(/-0\.05 BTC to/)).toBeInTheDocument();
        expect(detail).not.toHaveTextContent('+10,000,000,000 BTC');
    });

    it('[REGRESSION P1] totals demo fiat as each human quantity times its price', () => {
        markDemoWallet(WALLET_ID);
        const addresses = Object.fromEntries([
            'bitcoin-regtest',
            'litecoin-regtest',
            'dogecoin-regtest',
        ].map((chainId) => [chainId, [{ address: `${chainId}-demo` }]]));
        const rows = buildBalanceRows(
            synthesizeDemoBalances(addresses),
            defaultRegistry(),
        );
        const independentlyCalculatedTotal = rows.reduce((total, row) => (
            total + (Number(row.quantity) / (10 ** row.divisibility)) * row.fiatRate
        ), 0);

        expect(independentlyCalculatedTotal).toBeCloseTo(7_397_460.13, 8);
        render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <TotalBalanceHero
                    rows={rows}
                    walletId={WALLET_ID}
                    networkFilter="all"
                />
            </MessagingProvider>,
        );
        expect(screen.getByText('$7,397,460.13')).toBeInTheDocument();
    });
});
