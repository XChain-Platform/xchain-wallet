// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PlaceOrderPanel } from '../../../packages/core/src/shared/components/PlaceOrderPanel.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'a1', address: 'bc1qexample', publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's1',
};

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function balances({ xchain = '123456789', xchainDivisibility = 2, btc = '500000000' } = {}) {
    return {
        [CHAIN]: [{
            address: ADDRESS.address,
            balances: {
                native: { tick: 'BTC', quantity: btc, divisibility: 8 },
                tokens: [{ tick: 'XCHAIN', quantity: xchain, divisibility: xchainDivisibility }],
            },
        }],
    };
}

function messagingFor(overrides = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDRESS.id }),
        getWalletBalances: vi.fn().mockResolvedValue(balances()),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({ divisibility: 2 }),
        composeForConfirm: vi.fn(() => new Promise(() => {})),
        ...overrides,
    };
}

function panel(messaging, tick1 = 'XCHAIN', tick2 = 'BTC') {
    return (
        <MessagingProvider shell="desktop" messaging={messaging}>
            <PlaceOrderPanel walletId="w" chainId={CHAIN} tick1={tick1} tick2={tick2} />
        </MessagingProvider>
    );
}

async function settle() {
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
}

describe('PlaceOrderPanel stress', () => {
    it('refuses a give amount above a balance that prints with thousands separators', async () => {
        const messaging = messagingFor();
        render(panel(messaging));
        fireEvent.click(await screen.findByRole('radio', { name: 'Sell XCHAIN' }));
        await settle();
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '1234567.90' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place sell order' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Give amount exceeds your available XCHAIN balance of 1,234,567.89.',
        );
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('accepts a give amount equal to a balance with thousands separators', async () => {
        const messaging = messagingFor();
        render(panel(messaging));
        fireEvent.click(await screen.findByRole('radio', { name: 'Sell XCHAIN' }));
        await settle();
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '1234567.89' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place sell order' }));
        await settle();

        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('measures a preset expiration from the moment of submit, not from when the panel opened', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
        const messaging = messagingFor();
        render(panel(messaging));
        fireEvent.click(await screen.findByRole('radio', { name: 'Sell XCHAIN' }));
        await settle();
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Expiration'), { target: { value: '1d' } });

        vi.setSystemTime(new Date('2030-01-01T20:00:00Z'));
        fireEvent.click(screen.getByRole('button', { name: 'Place sell order' }));
        await settle();

        const params = messaging.composeForConfirm.mock.calls[0][0].actionData.params;
        expect(Number(params.EXPIRATION)).toBe(Math.floor(Date.now() / 1000) + 86400);
    });

    it('still places a one day order after the panel has been open for more than a day', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
        const messaging = messagingFor();
        render(panel(messaging));
        fireEvent.click(await screen.findByRole('radio', { name: 'Sell XCHAIN' }));
        await settle();
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Expiration'), { target: { value: '1d' } });

        vi.setSystemTime(new Date('2030-01-02T06:00:00Z'));
        fireEvent.click(screen.getByRole('button', { name: 'Place sell order' }));
        await settle();

        expect(screen.queryByRole('alert')).toBeNull();
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['.5', '0.5'],
        ['5.', '5'],
        ['007', '7'],
    ])('writes the size %s as %s on the wire', async (typed, wire) => {
        const messaging = messagingFor();
        render(panel(messaging));
        fireEvent.click(await screen.findByRole('radio', { name: 'Sell XCHAIN' }));
        await settle();
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: typed } });
        fireEvent.click(screen.getByRole('button', { name: 'Place sell order' }));
        await settle();

        const params = messaging.composeForConfirm.mock.calls[0][0].actionData.params;
        expect(params.GIVE_AMOUNT).toBe(wire);
        expect(params.GET_AMOUNT).toBe(wire);
    });
});

describe('PlaceOrderPanel decimal entry', () => {
    it.each([
        ['0,5', '0.5'],
        ['1,5', '1.5'],
        ['1,000', '1000'],
    ])('reads the size %s as %s on the wire', async (typed, wire) => {
        const messaging = messagingFor();
        render(panel(messaging));
        fireEvent.click(await screen.findByRole('radio', { name: 'Sell XCHAIN' }));
        await settle();
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: typed } });
        expect(screen.getByLabelText('Size (XCHAIN)')).toHaveValue(wire);
        fireEvent.click(screen.getByRole('button', { name: 'Place sell order' }));
        await settle();

        const params = messaging.composeForConfirm.mock.calls[0][0].actionData.params;
        expect(params.GIVE_AMOUNT).toBe(wire);
    });

    it.each(['1e2', '0x10', '-1', 'Infinity', '５'])('keeps the previous size when %s is typed', async (typed) => {
        render(panel(messagingFor()));
        fireEvent.click(await screen.findByRole('radio', { name: 'Sell XCHAIN' }));
        await settle();
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '7' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: typed } });
        expect(screen.getByLabelText('Size (XCHAIN)')).toHaveValue('7');
    });
});
