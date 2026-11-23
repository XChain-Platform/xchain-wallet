// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../../../packages/core/src/notifications/NotificationService.js';

const REQUEST_ID = '0123456789abcdef0123456789abcdef';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeHarness({ consent = false } = {}) {
    let handler;
    const notify = vi.fn(async () => true);
    notify.onAction = vi.fn((next) => { handler = next; return vi.fn(); });
    const sdk = {
        connectWs: vi.fn(async () => {}),
        disconnectWs: vi.fn(),
        onAddress: vi.fn((_address, next) => { handler = next; return vi.fn(); }),
    };
    const lookupCoinpayConsent = vi.fn(async () => consent);
    const setPayDueRequest = vi.fn();
    const openCoinpay = vi.fn();
    const buildCoinpayReview = vi.fn(async (_payload, context) => ({
        sentence: 'Pay for the matched order',
        amountText: '0.00015 BTC',
        expiresAt: 2_000,
        route: {
            chainId: context.chainId,
            address: context.address,
            orderMatchActionIndex: String(context.event?.order_match_action_index ?? '339'),
        },
    }));
    const service = new NotificationService({
        getActiveAddresses: async () => [{ chainId: 'bitcoin-mainnet', address: 'payer', label: 'Bitcoin' }],
        getSdkForChain: () => sdk,
        getSettings: async () => ({ notifications: { incomingReceipts: true } }),
        notify,
        lookupCoinpayConsent,
        buildCoinpayReview,
        openCoinpay,
        setPayDueRequest,
        newRequestId: () => REQUEST_ID,
        now: () => 1_000,
    });
    const emit = (data) => sdk.onAddress.mock.calls[0][1]({ type: 'COINPAY_REQUIRED', data });
    return { service, notify, emit, lookupCoinpayConsent, buildCoinpayReview, setPayDueRequest, openCoinpay };
}

const obligation = (payer, payee) => ({
    action_index: 340,
    order_match_action_index: 339,
    payer_address: payer,
    payee_address: payee,
    coin_amount: '15000',
    expiration: 2,
});

describe('CoinPay review composition', () => {
    it('adds N2 and the watch pay-due request only for a payer without consent', async () => {
        const h = makeHarness();
        await h.service.start();
        await h.emit(obligation('payer', 'seller'));
        await flush();

        expect(h.lookupCoinpayConsent).toHaveBeenCalledWith(expect.objectContaining({
            role: 'payer',
            chainId: 'bitcoin-mainnet',
            address: 'payer',
        }));
        expect(h.notify).toHaveBeenCalledTimes(2);
        expect(h.notify.mock.calls[1][0]).toMatchObject({
            id: REQUEST_ID,
            kind: 'paydue',
            category: 'paydue',
            actions: [{ id: 'openOnPhone', title: 'Open on phone' }],
        });
        expect(h.setPayDueRequest).toHaveBeenCalledWith(expect.objectContaining({
            id: REQUEST_ID,
            kind: 'paydue',
            expiresAt: 2_000,
        }));

        h.notify.onAction.mock.calls[0][0]({ id: REQUEST_ID, action: 'openOnPhone' });
        expect(h.openCoinpay).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            address: 'payer',
            orderMatchActionIndex: '339',
        });
        h.service.stop();
    });

    it('does not add N2 for a payee or for a payer with consent', async () => {
        const payee = makeHarness();
        await payee.service.start();
        await payee.emit(obligation('buyer', 'payer'));
        await flush();
        expect(payee.notify).toHaveBeenCalledTimes(1);
        expect(payee.lookupCoinpayConsent).not.toHaveBeenCalled();
        expect(payee.setPayDueRequest).not.toHaveBeenCalled();
        payee.service.stop();

        const consented = makeHarness({ consent: true });
        await consented.service.start();
        await consented.emit(obligation('payer', 'seller'));
        await flush();
        expect(consented.notify).toHaveBeenCalledTimes(1);
        expect(consented.setPayDueRequest).not.toHaveBeenCalled();
        consented.service.stop();
    });

    it('composes a manual auto-pay alert into N2 without a consent lookup', async () => {
        const h = makeHarness({ consent: true });
        await h.service.start();
        await h.service.composeCoinpayReview({
            kind: 'coinpay-autopay-manual',
            title: 'Auto pay is paused',
            body: 'Unlock to resume auto pay.',
            data: { chainId: 'bitcoin-mainnet', orderMatchActionIndex: '339' },
        }, {
            event: { order_match_action_index: 339 },
            chainId: 'bitcoin-mainnet',
            address: 'payer',
        });

        expect(h.lookupCoinpayConsent).not.toHaveBeenCalled();
        expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'paydue' }));
        expect(h.setPayDueRequest).toHaveBeenCalledOnce();
        h.service.stop();
    });
});
