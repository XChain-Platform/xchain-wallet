// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import kinds from '../../../packages/core/src/watch/contract/kinds.json';
import { watchInboxKind } from '../../../packages/core/src/watch/buildWatchInbox.js';

describe('watchInboxKind', () => {
    it.each([
        ['notification:tx-confirmed:tx-1', { kind: 'tx-confirmed', family: 'txConfirmations' }],
        [
            'notification:coinpay-required:invoice-1',
            { kind: 'coinpay-required', family: 'incomingReceipts' },
        ],
        ['notification:price-alert:asset:target', { kind: 'price-alert', family: 'priceAlerts' }],
        ['notification:paydue:invoice-2', { kind: 'paydue', family: 'paydue' }],
    ])('maps %s to its kind and family', (alertId, expected) => {
        expect(watchInboxKind(alertId, kinds)).toEqual(expected);
    });

    it.each([
        'notification:coinpay-autopay:invoice-1',
        'alert:x',
        'notification::x',
        'notification:toString:x',
        42,
    ])('returns null for %j', (alertId) => {
        expect(watchInboxKind(alertId, kinds)).toBeNull();
    });
});
