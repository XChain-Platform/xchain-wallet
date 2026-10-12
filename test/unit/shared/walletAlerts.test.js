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
import { buildWalletAlerts } from '../../../packages/core/src/shared/walletAlerts.js';

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
        expect(one.message).toBe('You have 1 conversation with unread messages.');
        const [many] = buildWalletAlerts({ messagingUnread: 3 }, { onMessaging: noop });
        expect(many.message).toBe('You have 3 conversations with unread messages.');
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

    it('is the only place in the shipped packages that defines an alert id', () => {
        const root = join(here, '..', '..', '..', 'packages');
        for (const file of [
            join(root, 'web', 'src', 'App.jsx'),
            join(root, 'core', 'src', 'shared', 'routes', 'Home.jsx'),
        ]) {
            const src = readFileSync(file, 'utf8');
            expect(src, file).not.toMatch(/['"](unread-messages|legacy-format)['"]/);
            expect(src, file).toMatch(/buildWalletAlerts\(/);
        }
    });
});
