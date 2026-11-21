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
    'packages/core/src/watch/contract/strings-surfaces.json',
), 'utf8'));

const alertKindLabels = {
    txConfirmed: 'Transaction confirmed',
    incomingReceipt: 'Incoming receipt',
    coinpayRequired: 'Payment due',
    coinpayAutopaid: 'Auto pay sent',
    coinpayAutopayManual: 'Auto pay needs attention',
    incomingPending: 'Incoming payment',
    incomingMessage: 'New message',
    governancePoll: 'Governance poll',
    deadline: 'Deadline',
    deadlineSummary: 'Deadlines',
    dispenserEscrow: 'Dispenser running low',
    dispenserFill: 'Dispenser fill',
    orderFill: 'Order fill',
    priceAlert: 'Price alert',
};

describe('watch surface strings', () => {
    it('provides an Always On label for every alert and request kind', () => {
        for (const [kind, label] of Object.entries(alertKindLabels)) {
            expect(strings[`n1.kind.${kind}`], kind).toBe(label);
        }
        expect(strings['n2.kind.request']).toBe('Request');
        expect(strings['n2.kind.paydue']).toBe('Payment due');
    });

    it('provides the handoff action and glance labels', () => {
        expect(strings['n2.openOnPhone']).toBe('Open on phone');
        expect(Object.fromEntries(Object.entries(strings).filter(([key]) => key.startsWith('g'))))
            .toEqual({
                'g1.alerts': 'Alerts',
                'g1.request': 'Request',
                'g1.updated': 'Updated',
                'g2.alerts': 'Alerts',
                'g2.balances': 'Balances',
                'g2.updated': 'Updated',
            });
    });

    it('keeps every native label namespaced, non-empty, and U12-safe', () => {
        expect(Object.keys(strings)).toHaveLength(23);
        expect(Object.keys(strings).every((key) => /^(n1|n2|g1|g2)\./u.test(key))).toBe(true);
        expect(Object.values(strings).every((value) => value.trim() === value && value.length > 0))
            .toBe(true);
        const copy = Object.values(strings).join('\n');
        expect(copy).not.toContain('\u2014');
        expect(copy).not.toMatch(/\b(?:Bitcoin|Dogecoin|Litecoin|mainnet|testnet|regtest)\b/iu);
    });
});
