// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { buildWatchTotals } from '../../../packages/core/src/watch/buildWatchTotals.js';

const rows = [
    { quantity: '125000000', divisibility: 8, fiatRate: 2 },
    { quantity: '300', divisibility: 2, fiatRate: 1.5 },
    { quantity: '1', divisibility: 0, fiatRate: null },
];

describe('buildWatchTotals', () => {
    it('builds mainnet totals and state from the host settings', () => {
        expect(buildWatchTotals(rows, {
            settings: {
                activeNetwork: 'mainnet',
                fiatCurrency: 'eur',
                watch: { startIn: 'units' },
            },
            session: 'unlocked',
            walletName: '  Daily wallet  ',
            accountId: 'account-1',
            activeAccountId: 'account-1',
        })).toEqual({
            session: 'unlocked',
            network: { kind: 'mainnet', isTest: false },
            fiatCode: 'EUR',
            unitDefault: 'units',
            walletName: 'Daily wallet',
            totals: { fiatText: '€7.00', unitsText: 'Balances' },
        });
    });

    it.each(['testnet', 'regtest'])('removes the fiat mode on %s', (activeNetwork) => {
        const result = buildWatchTotals(rows, {
            settings: { activeNetwork, fiatCurrency: 'USD', watch: { startIn: 'fiat' } },
        });

        expect(result).toMatchObject({
            network: { kind: activeNetwork, isTest: true },
            unitDefault: 'units',
            totals: { fiatText: '', unitsText: 'Balances' },
        });
    });

    it('publishes a name only for the active account', () => {
        expect(buildWatchTotals([], {
            walletName: 'Savings',
            accountId: 'account-2',
            activeAccountId: 'account-1',
        }).walletName).toBe('');
        expect(buildWatchTotals([], {
            walletName: '😀'.repeat(21),
            accountId: 'account-1',
            activeAccountId: 'account-1',
        }).walletName).toBe('😀'.repeat(20));
        expect(buildWatchTotals([], {
            walletName: 'Unscoped',
        }).walletName).toBe('');
        expect(buildWatchTotals([], {
            walletName: 'Missing active account',
            accountId: 'account-1',
        }).walletName).toBe('');
    });

    it('uses safe defaults for incomplete host state without changing rows', () => {
        const input = structuredClone(rows);

        expect(buildWatchTotals(rows)).toEqual({
            session: 'locked',
            network: { kind: 'mainnet', isTest: false },
            fiatCode: 'USD',
            unitDefault: 'fiat',
            walletName: '',
            totals: { fiatText: '$7.00', unitsText: 'Balances' },
        });
        expect(rows).toEqual(input);
    });
});
