// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/routes/AddressList.jsx', () => ({
    AddressList: ({ onPick, networkLocked, pickerUnavailableReason }) => {
        const unavailable = {
            id: 'watch-only',
            address: 'bc1qwatchonlypayment000000000000000000000',
            source: 'watch',
        };
        const reason = pickerUnavailableReason(unavailable, 'bitcoin-mainnet');
        return (
            <div>
                <span data-testid="network-lock">{networkLocked ? 'locked' : 'switchable'}</span>
                <button type="button" disabled={Boolean(reason)}>{reason}</button>
                <button
                    type="button"
                    onClick={() => onPick({
                        id: 'buyer-2',
                        address: 'bc1qsecondbuyer000000000000000000000000',
                        publicKey: '02bb',
                        derivationPath: "m/84'/0'/0'/0/1",
                        source: 'hd',
                    }, 'bitcoin-mainnet')}
                >
                    Pick second buyer
                </button>
            </div>
        );
    },
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const BUYER_ONE = 'bc1qfirstbuyer0000000000000000000000000';
const BUYER_TWO = 'bc1qsecondbuyer000000000000000000000000';
const OWNER = 'bc1qdispenserowner0000000000000000000000';
const DISPENSER = {
    action_index: '734',
    source: OWNER,
    address: OWNER,
    give_tick: 'PEPECREATURE',
    give_amount: '100',
    get_tick: 'MEMEVALID',
    get_amount: '5',
    escrow_remaining: '1000',
    status: 'open',
    current_status: 'open',
};
const buyers = [
    {
        id: 'buyer-1', address: BUYER_ONE, publicKey: '02aa',
        derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
    },
    {
        id: 'buyer-2', address: BUYER_TWO, publicKey: '02bb',
        derivationPath: "m/84'/0'/0'/0/1", source: 'hd',
    },
    { id: 'watch-only', address: 'bc1qwatchonlypayment000000000000000000000', source: 'watch' },
];

function mount() {
    const target = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue(DISPENSER),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: buyers }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: buyers[0] }),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getDispensersForAddress: vi.fn().mockResolvedValue({ data: [DISPENSER] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: buyers.slice(0, 2).map((address) => ({
                address: address.address,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: 'MEMEVALID', quantity: '250', divisibility: 0 }],
                },
            })),
        }),
        getSettings: vi.fn().mockResolvedValue({}),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|MEMEVALID', version: 1,
            decoded: { summary: 'Send payment', details: [], warnings: [] },
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    const messaging = new Proxy(target, {
        get(value, key) {
            if (key in value) return value[key];
            const stub = vi.fn().mockResolvedValue(null);
            value[key] = stub;
            return stub;
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DispenserDetail
                walletId="wallet-1"
                chainId={CHAIN}
                actionIndex={DISPENSER.action_index}
                onBack={() => {}}
                onCanceled={() => {}}
            />
        </MessagingProvider>,
    );
    return target;
}

afterEach(cleanup);

describe('DispenserDetail own-address picker', () => {
    it('locks payment picks to the dispenser network and reviews the picked payer', async () => {
        const messaging = mount();
        const field = await screen.findByRole('textbox', { name: 'Pay from' });
        expect(field).toHaveAttribute('readonly');
        expect(field).toHaveValue(BUYER_ONE);
        expect(screen.queryByRole('combobox', { name: 'Pay from' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'About Pay from' }));
        expect(screen.getByRole('tooltip')).toHaveTextContent('Wallet address that sends the payment for this dispenser purchase.');
        fireEvent.click(screen.getByRole('button', { name: 'About Pay from' }));
        fireEvent.click(screen.getByRole('button', { name: 'About Fills' }));
        expect(screen.getAllByRole('tooltip').some((tip) => (
            /Number of whole dispenser fills to buy/.test(tip.textContent || '')
        ))).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'About Fills' }));

        fireEvent.click(screen.getByRole('button', { name: 'Choose payment address' }));
        expect(screen.getByTestId('network-lock')).toHaveTextContent('locked');
        expect(screen.getByRole('button', { name: 'This address cannot sign a payment.' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Pick second buyer' }));

        await waitFor(() => expect(screen.getByRole('textbox', { name: 'Pay from' })).toHaveValue(BUYER_TWO));
        const buy = screen.getByRole('button', { name: 'Buy 1 fill' });
        await waitFor(() => expect(buy).toBeEnabled());
        expect(buy.className).toMatch(/success/);
        expect(buy.querySelector('svg')).toBeTruthy();
        fireEvent.click(buy);
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            from: expect.objectContaining({ address: BUYER_TWO, addressId: 'buyer-2' }),
        })));
    });
});
