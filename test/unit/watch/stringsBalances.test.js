// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const strings = JSON.parse(readFileSync(join(
    process.cwd(),
    'packages/core/src/watch/contract/strings-balances.json',
), 'utf8'));

const expectedStrings = {
    'w1.title': 'Balances',
    'w1.requestWaiting': '1 request waiting',
    'w1.empty': 'No balances yet',
    'w1.receive': 'Receive',
    'w2.title': 'Token detail',
    'w2.change24h': '24 h change',
    'w2.type': 'Type',
    'w2.supply': 'Supply',
    'w2.divisibility': 'Divisibility',
    'w2.status': 'Status',
    'w2.creator': 'Creator',
    'w2.description': 'Description',
    'w2.priceSource': 'Price source',
    'w2.openOnPhone': 'Open on phone',
    'w2.moreDetails': 'More details when your phone is near',
    'w2.detailsUnavailable': 'Details unavailable',
    'state.status': 'Status',
    'state.phoneReachable': 'Phone reachable',
    'state.lastSync': 'Last sync',
    'state.session': 'Session',
    'state.hideAmounts': 'Hide amounts',
    'state.version': 'Version',
    'state.sessionUnknown': 'Session unknown',
    'state.notSetUp': 'Not set up',
    'state.openWalletOnPhone': 'Open XChain Wallet on your phone',
    'state.watchDisabled': 'Show wallet on watch is off on your phone',
    'state.openOnPhone': 'Open on phone',
    'state.loading': 'Waiting for phone',
    'state.age': 'Updated 12 min ago',
    'state.ageAmber': 'Updated 12 min ago',
    'state.stale24h': 'Open XChain Wallet on your phone to refresh',
    'state.locked': 'Wallet locked on phone',
    'state.unreachable': 'Phone not in range',
    'state.hidden': '••••',
    'state.noPriceYet': 'No price yet',
    'state.moreOnPhone': 'More on phone',
    'state.balanceUnavailable': 'Balance unavailable',
    'color.amber': '#E8A100',
};

describe('watch balance strings', () => {
    it('pins every Design key and its exact English copy', () => {
        expect(strings).toStrictEqual(expectedStrings);
    });

    it('contains only watch namespaces and U12-safe copy', () => {
        const entries = Object.entries(strings);
        expect(entries.every(([key]) => /^(w1|w2|state|color)\./u.test(key))).toBe(true);
        expect(entries.every(([, value]) => typeof value === 'string' && value.length > 0)).toBe(true);

        const copy = entries.map(([, value]) => value).join('\n');
        expect(copy).not.toContain('—');
        expect(copy).not.toMatch(/\b(?:Bitcoin|Dogecoin|Litecoin|mainnet|testnet|regtest)\b/iu);
    });
});
