// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { reconcileStoredList } from '../../../packages/core/src/airdrop/parseRecipients.js';

const BTC_MAINNET = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const BTC_LEGACY = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';

describe('reconcileStoredList edge cases', () => {
    it('treats non-array inputs as empty lists', () => {
        expect(reconcileStoredList(null, undefined)).toEqual({
            expectedCount: 0,
            storedCount: 0,
            missing: [],
            ok: true,
        });
    });

    it('normalizes bare strings and both supported stored-row shapes', () => {
        expect(reconcileStoredList(
            [BTC_MAINNET, BTC_LEGACY],
            [{ address: ` ${BTC_MAINNET} ` }, { item: BTC_LEGACY }],
        )).toEqual({
            expectedCount: 2,
            storedCount: 2,
            missing: [],
            ok: true,
        });
    });

    it('ignores empty stored rows and counts duplicate rows once', () => {
        const out = reconcileStoredList(
            [BTC_LEGACY],
            [null, '', '   ', {}, { item: null }, BTC_LEGACY, ` ${BTC_LEGACY} `],
        );

        expect(out.storedCount).toBe(1);
        expect(out.ok).toBe(true);
    });

    it('counts blank expected entries without reporting them as missing', () => {
        const out = reconcileStoredList(['', null, ` ${BTC_LEGACY} `], [BTC_LEGACY]);

        expect(out.expectedCount).toBe(3);
        expect(out.missing).toEqual([]);
        expect(out.ok).toBe(true);
    });

    it('case-folds only structurally valid bech32 addresses', () => {
        const malformed = `bc1${'q'.repeat(39)}`;

        expect(reconcileStoredList([BTC_MAINNET], [BTC_MAINNET.toUpperCase()]).ok).toBe(true);
        expect(reconcileStoredList([malformed], [malformed.toUpperCase()]).missing)
            .toEqual([malformed]);
    });

    it('does not let an empty address property fall through to item', () => {
        const out = reconcileStoredList([BTC_LEGACY], [{ address: '', item: BTC_LEGACY }]);

        expect(out.storedCount).toBe(0);
        expect(out.missing).toEqual([BTC_LEGACY]);
        expect(out.ok).toBe(false);
    });
});
