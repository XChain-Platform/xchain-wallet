// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every notification a watcher raises also lands in the one Notifications
// inbox. Payments due (a matched order waiting on a coin payment), Coinpay
// autopay and payment deadlines file under Payments; the inbox filter and
// its counts depend on that type.

import { describe, expect, it, vi } from 'vitest';
import {
    notificationToAlert,
    notificationType,
    withAlertInbox,
} from '../../../packages/core/src/notifications/notificationInbox.js';
import { createAlertInbox } from '../../../packages/core/src/shared/alertInbox.js';

function memoryStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };
}

describe('notification inbox types', () => {
    it.each([
        // NotificationService: an order matched and its coin payment is due.
        ['coinpay-required', 'payments'],
        // CoinpayAutopayWatcher: an autopay needs the user, or it paid.
        ['coinpay-autopay-manual', 'payments'],
        ['coinpay-autopaid', 'payments'],
        ['coinpay-autopay', 'payments'],
        // DeadlineWatcher: one deadline about to pass.
        ['deadline', 'payments'],
        ['payment-deadline', 'payments'],
        ['price-alert', 'price'],
        ['incoming-message', 'messages'],
        ['incoming-receipt', 'activity'],
        ['tx-confirmed', 'activity'],
    ])('files %s under %s', (kind, type) => {
        expect(notificationType(kind)).toBe(type);
    });

    it('stores the short three-line payment copy and starts unread', () => {
        const alert = notificationToAlert({
            kind: 'coinpay-required',
            title: 'Coin payment due',
            body: 'An order was matched and needs a coin payment.',
            data: { matchIndex: 42 },
        }, 1000);

        expect(alert).toEqual({
            id: 'notification:coinpay-required:42',
            type: 'payments',
            label: 'Payment due',
            title: 'Coin payment due',
            message: 'Pay before the window closes',
            at: 1000,
            read: false,
        });
    });
});

describe('withAlertInbox', () => {
    it('records Payments due and Coinpay notifications in the inbox, then still notifies', async () => {
        const inbox = createAlertInbox(memoryStorage());
        const notify = vi.fn(() => true);
        let clock = 0;
        const send = withAlertInbox(notify, {
            recordAlert: (alert) => inbox.record(alert),
            now: () => { clock += 1; return clock; },
        });

        await send({ kind: 'coinpay-required', title: 'Coin payment due', body: 'Pay before the window closes.', data: { matchIndex: 7 } });
        await send({ kind: 'coinpay-autopay-manual', title: 'Autopay needs you', body: 'Approve the payment.', data: { id: 'auto-1' } });

        expect(notify).toHaveBeenCalledTimes(2);
        const rows = await inbox.list();
        expect(rows.map((row) => [row.id, row.type])).toEqual([
            ['notification:coinpay-autopay-manual:auto-1', 'payments'],
            ['notification:coinpay-required:7', 'payments'],
        ]);
        expect(await inbox.unreadCount()).toBe(2);
    });

    it('records one inbox row when the same payment is notified twice', async () => {
        const inbox = createAlertInbox(memoryStorage());
        const send = withAlertInbox(() => true, { recordAlert: (alert) => inbox.record(alert), now: () => 5 });
        const payload = { kind: 'coinpay-required', title: 'Coin payment due', body: 'Pay.', data: { matchIndex: 9 } };

        await send(payload);
        await send(payload);

        expect(await inbox.list()).toHaveLength(1);
    });

    it('still notifies when the inbox write fails', async () => {
        const notify = vi.fn(() => true);
        const warn = vi.fn();
        const send = withAlertInbox(notify, {
            recordAlert: () => { throw new Error('storage full'); },
            logger: { warn },
        });

        await expect(send({ kind: 'deadline', title: 'Order expires soon', body: 'Soon.' })).resolves.toBe(true);
        expect(notify).toHaveBeenCalledOnce();
        expect(warn).toHaveBeenCalledOnce();
    });
});
