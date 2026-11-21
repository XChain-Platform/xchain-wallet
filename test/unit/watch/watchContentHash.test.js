// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { watchContentHash } from '../../../packages/core/src/watch/watchSync.js';

describe('watchContentHash', () => {
    it('hashes reordered object keys alike at every depth while keeping array order', () => {
        const first = {
            wallet: { name: 'primary', chains: { bitcoin: true, litecoin: false } },
            entries: [{ tick: 'XCP', balance: 4 }, { balance: 2, tick: 'PEPECASH' }],
        };
        const reordered = {
            entries: [{ balance: 4, tick: 'XCP' }, { tick: 'PEPECASH', balance: 2 }],
            wallet: { chains: { litecoin: false, bitcoin: true }, name: 'primary' },
        };

        const hash = watchContentHash(first);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(hash).toBe(watchContentHash(reordered));
        expect(hash).not.toBe(watchContentHash({
            ...reordered,
            entries: [...reordered.entries].reverse(),
        }));
    });

    it('ignores a builtAt change when builtAt is omitted', () => {
        const first = { builtAt: '2026-01-01T00:00:00Z', state: { height: 100 } };
        const later = { builtAt: '2026-01-02T00:00:00Z', state: { height: 100 } };

        expect(watchContentHash(first, ['builtAt']))
            .toBe(watchContentHash(later, ['builtAt']));
        expect(watchContentHash({ state: { builtAt: 1 } }, ['builtAt']))
            .not.toBe(watchContentHash({ state: { builtAt: 2 } }, ['builtAt']));
    });

    it('detects a balancesAt change when balancesAt is not omitted', () => {
        const first = { builtAt: 1, balancesAt: 10, balances: { XCP: '4' } };
        const later = { builtAt: 2, balancesAt: 11, balances: { XCP: '4' } };

        expect(watchContentHash(first, ['builtAt']))
            .not.toBe(watchContentHash(later, ['builtAt']));
    });
});
