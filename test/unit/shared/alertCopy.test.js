// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Unit: every alert row is exactly three lines, each one line tall at 360 px
// (and at text scale 1.3 through the ellipsis clamp). Each alert kind the page
// renders keeps its label, detail and description inside the character
// budgets derived from the 360 px width, with the worst-case data a kind can
// carry; the row's CSS clamps each line to one line.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    ALERT_LABEL_MAX, ALERT_TITLE_MAX, ALERT_MESSAGE_MAX,
    clip, compactNotification, paymentDueCopy, airdropCopy,
} from '../../../packages/core/src/shared/alertCopy.js';
import { buildWalletAlerts, buildPendingNoticeAlerts } from '../../../packages/core/src/shared/walletAlerts.js';
import { notificationToAlert } from '../../../packages/core/src/notifications/notificationInbox.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../packages/core/src/shared/routes');

const LONG = 'A'.repeat(60);
const BIG = '123456789012345678901234567890';
const noop = () => {};

// One worst-case payload per notification kind (long data, long titles, long bodies).
const NOTIFICATIONS = {
    'incoming-pending': { kind: 'incoming-pending', title: `${BIG} ${LONG} pending`, body: `Payment to your ${LONG} address is waiting for confirmation.` },
    'tx-confirmed': { kind: 'tx-confirmed', title: `${BIG} ${LONG} confirmed`, body: `Your ${LONG} transaction is confirmed.` },
    'incoming-message': { kind: 'incoming-message', title: 'New message', body: `You received a message on ${LONG}.` },
    'incoming-receipt': { kind: 'incoming-receipt', title: `${BIG} ${LONG} received`, body: `Payment arrived at your ${LONG} address.` },
    'order-fill': { kind: 'order-fill', title: 'Swap matched', body: `Your swap on ${LONG} was matched.` },
    'dispenser-fill': { kind: 'dispenser-fill', title: 'Dispenser sale', body: `Someone bought from your dispenser on ${LONG}.` },
    'coinpay-required payer': { kind: 'coinpay-required', title: 'Payment due for a matched order', body: `One of your orders on ${LONG} was matched. Send the coin payment before the payment window closes, or the match expires.` },
    'coinpay-required payee': { kind: 'coinpay-required', title: 'Order matched, awaiting payment', body: `One of your orders on ${LONG} was matched. The buyer has until the payment window closes.` },
    'coinpay-required neutral': { kind: 'coinpay-required', title: 'Coin payment due', body: `An order on ${LONG} was matched and needs a coin payment.` },
    'autopay locked': { kind: 'coinpay-autopay-manual', title: 'Auto pay is paused', body: `${BIG} ${'X'.repeat(12)} is due for order #${BIG}. Unlock to resume auto pay, or open Payments due.`, data: { reason: 'locked' } },
    'autopay unusable-amount': { kind: 'coinpay-autopay-manual', title: 'Payment needs attention', body: `The amount due for order #${BIG} could not be read. Open Payments due to review it.`, data: { reason: 'unusable-amount' } },
    'autopay amounts-unavailable': { kind: 'coinpay-autopay-manual', title: 'Payment needs attention', body: `Payment for order #${BIG} could not be verified. Open Payments due to review it.`, data: { reason: 'amounts-unavailable' } },
    'autopay balance-short': { kind: 'coinpay-autopay-manual', title: `Not enough ${'X'.repeat(12)} for auto pay`, body: `Order #${BIG} needs ${BIG} ${'X'.repeat(12)}. Fund its address or open Payments due.`, data: { reason: 'balance-short' } },
    'autopay pay-failed': { kind: 'coinpay-autopay-manual', title: 'Auto pay failed', body: `Could not pay ${BIG} BTC for order #${BIG}: ${LONG}. Open Payments due before the deadline.`, data: { reason: 'pay-failed' } },
    'autopay past-cutoff': { kind: 'coinpay-autopay-manual', title: 'Payment needs attention', body: `Pay ${BIG} ${'X'.repeat(12)} for order #${BIG} before the deadline. Auto pay is off; open Payments due.`, data: { reason: 'past-arming-cutoff' } },
    'autopay other reason': { kind: 'coinpay-autopay-manual', title: 'Payment needs attention', body: `${BIG} BTC is due for order #${BIG}. Open Payments due to review it.`, data: { reason: 'something-new' } },
    'coinpay-autopaid': { kind: 'coinpay-autopaid', title: 'Auto pay complete', body: `Paid ${BIG} ${'X'.repeat(12)} for order #${BIG}.` },
    'deadline-summary': { kind: 'deadline-summary', title: '12 deadlines approaching', body: `12 items on ${LONG} expire or close within 24 hours. Your order is first, in 3 hours.` },
    'deadline order': { kind: 'deadline', title: 'Dispenser expires soon', body: `Your dispenser #${BIG} on ${LONG} expires in 3 hours 20 minutes.`, data: { kind: 'dispenser', actionIndex: BIG } },
    'deadline poll': { kind: 'deadline', title: 'Poll closes soon', body: `The ${LONG} poll you voted in on ${LONG} closes in about 12 blocks (block 1234567).`, data: { kind: 'poll', actionIndex: BIG } },
    'dispenser-escrow low': { kind: 'dispenser-escrow', title: 'ALIGHT dispenser is running low', body: `Dispenser #${BIG} on ${LONG} has enough ALIGHT for 3 more buyers.`, data: { dispensesLeft: 3 } },
    'dispenser-escrow empty': { kind: 'dispenser-escrow', title: 'ALIGHT dispenser is empty', body: `Dispenser #${BIG} on ${LONG} has no ALIGHT left. Top it up to resume sales.` },
    'governance-poll': { kind: 'governance-poll', title: 'Governance poll', body: `A ${LONG} poll is open on ${LONG}.`, data: { tick: LONG, binding: false, endBlock: 123456789012 } },
    'governance-poll binding': { kind: 'governance-poll', title: 'Binding governance poll', body: `A binding ${LONG} poll is open.`, data: { tick: LONG, binding: true } },
    'price-alert': { kind: 'price-alert', title: 'Price alert', body: `${LONG} rose above $1,000,000,000,000.00.` },
    'unknown kind': { kind: 'something-new', title: LONG + LONG, body: `${LONG} ${LONG} ${LONG}. Second sentence.` },
};

function expectThreeShortLines(copy) {
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.message.length).toBeGreaterThan(0);
    expect(copy.title.length).toBeLessThanOrEqual(ALERT_TITLE_MAX);
    expect(copy.message.length).toBeLessThanOrEqual(ALERT_MESSAGE_MAX);
    expect((copy.label || '').length).toBeLessThanOrEqual(ALERT_LABEL_MAX);
    for (const line of [copy.label, copy.title, copy.message]) expect(String(line || '')).not.toMatch(/[\n\r]/);
}

describe('alert row budgets derived from the 360 px width', () => {
    it('keeps the budgets inside what 238 px (lines 2 and 3) and the label share allow', () => {
        // 238 px = 360 - 2*16 gutter - 2*8 row padding - 40 icon - 3*8 gaps - 10 chevron.
        expect(ALERT_TITLE_MAX * 7.3).toBeLessThanOrEqual(238 + 1);
        expect(ALERT_MESSAGE_MAX * 6.2).toBeLessThanOrEqual(238 + 1);
        expect(ALERT_LABEL_MAX * 8).toBeLessThanOrEqual(238 - 48);
    });

    it('clips with an ellipsis and never grows the text', () => {
        expect(clip('short', 10)).toBe('short');
        expect(clip('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
        expect(clip('x'.repeat(50), 10).length).toBe(10);
    });
});

describe('every notification kind stays three short lines', () => {
    for (const [name, payload] of Object.entries(NOTIFICATIONS)) {
        it(`${name}: label, detail and description fit their budgets`, () => {
            expectThreeShortLines(compactNotification(payload));
            const alert = notificationToAlert(payload, 1);
            expectThreeShortLines(alert);
        });
    }

    it('covers every kind the notification inbox maps by name', () => {
        const kinds = new Set(Object.values(NOTIFICATIONS).map((payload) => payload.kind));
        for (const kind of ['incoming-pending', 'tx-confirmed', 'incoming-message', 'incoming-receipt', 'order-fill', 'dispenser-fill',
            'coinpay-required', 'coinpay-autopay-manual', 'coinpay-autopaid', 'deadline-summary', 'deadline', 'dispenser-escrow',
            'governance-poll', 'price-alert']) expect(kinds.has(kind)).toBe(true);
    });

    it('reads short payment-due copy: amount, short order id, no long ids', () => {
        const copy = compactNotification(NOTIFICATIONS['autopay past-cutoff']);
        expect(copy.title).toMatch(/^Pay /);
        expect(copy.message).toBe('Auto pay is off, pay by hand');
        expect(compactNotification({ kind: 'governance-poll', title: 'Governance poll', body: '', data: { tick: 'ALIGHT', binding: false } }))
            .toMatchObject({ label: 'Governance poll', title: 'ALIGHT poll is open' });
    });
});

describe('wallet-derived alerts stay three short lines', () => {
    it('unread messages (one, many, and a huge count), migration and legacy format', () => {
        const handlers = { onMessaging: noop, onMigrateToBip39: noop };
        for (const count of [1, 3, 999999]) {
            const [alert] = buildWalletAlerts({ messagingUnread: count }, handlers);
            expect(alert.id).toBe('unread-messages');
            expectThreeShortLines(alert);
        }
        const [legacy] = buildWalletAlerts({ activeWallet: { id: 'w1', format: 'counterwallet-legacy' } }, handlers);
        expect(legacy.id).toBe('legacy-format');
        expectThreeShortLines(legacy);
        expect(buildWalletAlerts({ messagingUnread: 1 }, handlers)[0].message).toBe('1 conversation has unread messages');
    });

    it('payment due notice: amount and a short order id, for signer and watcher', () => {
        const rec = { chainId: 'bitcoin', orderMatchActionIndex: BIG, coinAmount: BIG, address: 'a' };
        for (const isWatcherMode of [false, true]) {
            const [alert] = buildPendingNoticeAlerts({ pendingCoinpays: [rec], isWatcherMode }, { onResumeCoinpay: noop });
            expect(alert.id.startsWith('payment-due:')).toBe(true);
            expectThreeShortLines(alert);
            expect(alert.title.startsWith('Pay ')).toBe(true);
            expect(alert.message).not.toContain(BIG);
        }
        expectThreeShortLines(paymentDueCopy({ amount: '0.0123', ticker: 'BTC', order: '1a2b3c' }));
        expect(paymentDueCopy({ amount: '0.0123', ticker: 'BTC', order: '1a2b3c' }).title).toBe('Pay 0.0123 BTC');
    });

    it('airdrop notice: both stages, one recipient and many', () => {
        for (const stage of ['waiting-index', 'ready-to-airdrop']) {
            const [alert] = buildPendingNoticeAlerts({ pendingAirdrops: [{ id: 'd1', amountPer: BIG, token: LONG, recipients: new Array(5000), stage }] }, { onResumeAirdrop: noop });
            expectThreeShortLines(alert);
        }
        expectThreeShortLines(airdropCopy({ amount: '1', token: 'ALIGHT', count: 1, stage: 'ready-to-airdrop' }));
    });
});

describe('the alert row clamps every line to one line', () => {
    const css = readFileSync(join(root, 'AlertsRoute.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const jsx = readFileSync(join(root, 'AlertsRoute.jsx'), 'utf8');
    const ruleFor = (selector) => {
        const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((match) => match[1].split(',').map((s) => s.trim()).includes(selector));
        return blocks.map((match) => match[2]).join('\n');
    };

    for (const selector of ['.typeLabel', '.title', '.message']) {
        it(`${selector} never wraps and ends in an ellipsis`, () => {
            const rule = ruleFor(selector);
            expect(rule).toMatch(/white-space:\s*nowrap/);
            expect(rule).toMatch(/text-overflow:\s*ellipsis/);
            expect(rule).toMatch(/overflow:\s*hidden/);
            expect(rule).not.toMatch(/overflow-wrap:\s*anywhere|-webkit-line-clamp|white-space:\s*(normal|pre-wrap)/);
        });
    }

    it('lays the three lines on three grid rows and renders exactly three line elements', () => {
        expect(ruleFor('.rowGrid')).toMatch(/grid-template-rows:\s*auto auto auto/);
        expect(ruleFor('.copy')).toMatch(/display:\s*contents/);
        expect(ruleFor('.typeLabel')).toMatch(/grid-row:\s*1/);
        expect(ruleFor('.title')).toMatch(/grid-row:\s*2/);
        expect(ruleFor('.message')).toMatch(/grid-row:\s*3/);
        expect([...jsx.matchAll(/data-alert-line="/g)]).toHaveLength(3);
    });
});
