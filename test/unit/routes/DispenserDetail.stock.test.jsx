// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const SELLER = 'bc1qstockstockstockstockstockstockstocksell';
const BUYER = {
    id: 'buyer-1',
    address: 'bc1qstockstockstockstockstockstockstockbuyr',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const ACTION = {
    action_index: '77',
    source: SELLER,
    give_tick: 'PEPECASH',
    give_amount: '1',
    give_escrow: '100',
    get_tick: 'XCP',
    get_amount: '2',
    status: 'valid',
};
const DISPENSER = {
    ...ACTION,
    give_escrow: '60',
    dispense_count: '40',
    current_status: 'open',
    state: { status: 'open', give_remaining: '60' },
};

afterEach(() => cleanup());

function messaging() {
    const host = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue({ action: ACTION, dispenser: DISPENSER }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [BUYER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: BUYER.id } }),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getDispenserLifecycle: vi.fn().mockResolvedValue({ data: [] }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'available' }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getTokenInfo: vi.fn().mockResolvedValue(null),
        getListByActionIndex: vi.fn().mockResolvedValue(null),
    };
    return new Proxy(host, {
        get(target, property) {
            if (property in target) return target[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

describe('DispenserDetail stock', () => {
    it('shows the same original-escrow total in Buy and Details', async () => {
        render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <DispenserDetail
                    walletId="wallet-stock"
                    chainId={CHAIN}
                    actionIndex="77"
                    onBack={() => {}}
                    embedded
                />
            </MessagingProvider>,
        );

        const buy = await screen.findByTestId('embedded-buy');
        const details = screen.getByTestId('embedded-details');
        expect(within(buy).getByText('60 of 100 left')).toBeInTheDocument();
        expect(within(details).getByText('60 of 100 left')).toBeInTheDocument();
        expect(within(buy).getByRole('meter', { name: 'Stock left' }))
            .toHaveAttribute('aria-valuenow', '60');
    });

    it("states the payment token balance in the wide buy form, as the full page does", async () => {
        render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <DispenserDetail
                    walletId="wallet-stock"
                    chainId={CHAIN}
                    actionIndex="77"
                    onBack={() => {}}
                    embedded
                />
            </MessagingProvider>,
        );

        const form = await screen.findByTestId("dispenser-buy-form");
        expect(within(form).getByTestId("buy-balance")).toHaveTextContent(/XCP/);
        expect(screen.queryByText("Pay to buy")).toBeNull();
    });
});
