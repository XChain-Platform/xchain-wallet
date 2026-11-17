// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: the shared wallet-level alert list that Home and the web menu's
// Alerts panel both build from, so neither shell holds its own copy.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildWalletAlerts, buildPendingNoticeAlerts, withoutDeadNoticeAlerts } from '../../../packages/core/src/shared/walletAlerts.js';

const here = dirname(fileURLToPath(import.meta.url));

const legacy = { id: 'w1', format: 'counterwallet-legacy' };
const noop = () => {};

describe('buildWalletAlerts', () => {
    it('returns no alerts when nothing applies', () => {
        expect(buildWalletAlerts({ activeWallet: { format: 'bip39' }, messagingUnread: 0 }, {
            onMessaging: noop, onMigrateToBip39: noop,
        })).toEqual([]);
        expect(buildWalletAlerts()).toEqual([]);
    });

    it('words the unread-messages alert for one and for several conversations', () => {
        const [one] = buildWalletAlerts({ messagingUnread: 1 }, { onMessaging: noop });
        expect(one.id).toBe('unread-messages');
        expect(one.message).toBe('1 conversation has unread messages');
        const [many] = buildWalletAlerts({ messagingUnread: 3 }, { onMessaging: noop });
        expect(many.message).toBe('3 conversations have unread messages');
        expect(many.action.label).toBe('Open Messaging');
    });

    it('hides an alert whose handler the shell did not pass', () => {
        expect(buildWalletAlerts({ activeWallet: legacy, messagingUnread: 2 }, {})).toEqual([]);
    });

    it('offers the legacy-format upgrade only for a counterwallet-legacy wallet', () => {
        const [alert] = buildWalletAlerts({ activeWallet: legacy }, { onMigrateToBip39: noop });
        expect(alert.id).toBe('legacy-format');
        expect(alert.title).toBe('Older recovery phrase format');
        expect(alert.action.label).toBe('Upgrade recovery phrase');
        expect(buildWalletAlerts({ activeWallet: { format: 'bip39' } }, { onMigrateToBip39: noop })).toEqual([]);
    });

    it('lists unread messages first and wires each action to the handler passed in', () => {
        const onMessaging = () => {};
        const onMigrateToBip39 = () => {};
        const alerts = buildWalletAlerts({ activeWallet: legacy, messagingUnread: 5 }, { onMessaging, onMigrateToBip39 });
        expect(alerts.map((a) => a.id)).toEqual(['unread-messages', 'legacy-format']);
        expect(alerts[0].action.onSelect).toBe(onMessaging);
        expect(alerts[1].action.onSelect).toBe(onMigrateToBip39);
    });

    it('maps derived alerts to inbox types and merges persisted entries by id', () => {
        const alerts = buildWalletAlerts({
            activeWallet: legacy,
            messagingUnread: 2,
            at: 100,
            inboxAlerts: [
                { id: 'unread-messages', type: 'messages', title: 'old', message: 'old', at: 50, read: true },
                { id: 'price-1', type: 'price', title: 'Price alert', message: 'BTC moved.', at: 200, read: false },
            ],
        }, { onMessaging: noop, onMigrateToBip39: noop });

        expect(alerts.map((alert) => alert.id)).toEqual(['price-1', 'legacy-format', 'unread-messages']);
        expect(alerts.find((alert) => alert.id === 'unread-messages')).toMatchObject({ type: 'messages', read: true, at: 50 });
        expect(alerts.find((alert) => alert.id === 'legacy-format').type).toBe('wallet');
    });

    it('lists a payment due and an airdrop only while the notice is pending, read or not', () => {
        const pay = { chainId: 'bitcoin', orderMatchActionIndex: 7, coinAmount: '0.1', address: 'a' };
        const handlers = { onResumeCoinpay: noop, onResumeAirdrop: noop };
        const live = buildPendingNoticeAlerts({ pendingCoinpays: [pay], pendingAirdrops: [{ id: 'd1', stage: 'ready-to-airdrop' }] }, handlers);
        expect(live.map((a) => a.id)).toEqual(['payment-due:bitcoin:7', 'airdrop-pending:d1']);

        // The item was opened, so the inbox holds a read copy of it.
        const stored = live.map((a) => ({ id: a.id, type: a.type, title: a.title, message: a.message, at: a.at, read: true }));
        const wallet = { id: 'price-1', type: 'price', title: 'p', message: 'm', at: 1, read: false };
        const countUnread = (rows, notices) => [...withoutDeadNoticeAlerts(rows, notices), ...notices].filter((a) => !a.read).length;

        // Live: the read copy stays listed and read; the unread live item badges.
        expect(withoutDeadNoticeAlerts([...stored, wallet], live).map((a) => a.id)).toEqual(['payment-due:bitcoin:7', 'airdrop-pending:d1', 'price-1']);
        expect(countUnread([wallet], live)).toBe(3);

        // The payment is made and the airdrop resumed: nothing is left of either.
        const cleared = buildPendingNoticeAlerts({ pendingCoinpays: [], pendingAirdrops: [] }, handlers);
        expect(withoutDeadNoticeAlerts([...stored, wallet], cleared)).toEqual([wallet]);
        expect(countUnread([...stored, wallet], cleared)).toBe(1);
    });

    it('is the only place in the shipped packages that defines an alert id', () => {
        const root = join(here, '..', '..', '..', 'packages');
        for (const file of [
            join(root, 'web', 'src', 'App.jsx'),
            // Home no longer builds alerts: each shell builds them for its menu
            // bell, so the other two shells call the shared builder as well.
            join(root, 'extension', 'src', 'popup', 'App.jsx'),
            join(root, 'desktop', 'renderer', 'App.jsx'),
        ]) {
            const src = readFileSync(file, 'utf8');
            expect(src, file).not.toMatch(/['"](unread-messages|legacy-format)['"]/);
            expect(src, file).toMatch(/buildWalletAlerts\(/);
        }
    });
});
