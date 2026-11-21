// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The indexer keeps one address row per case-insensitive spelling and keeps
// the first spelling it saw, which can come from an earlier LIST item it
// rejected. A later valid member of that row reads back in the earlier
// spelling, so the read-back must not call it rejected or foreign.

import { describe, expect, it } from 'vitest';
import { reconcileStoredList } from '../../../packages/core/src/airdrop/parseRecipients.js';

const BTC_MAINNET = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const BTC_LEGACY = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const MIXED = `${BTC_MAINNET.slice(0, 4)}${BTC_MAINNET.slice(4, 5).toUpperCase()}${BTC_MAINNET.slice(5)}`;

describe('reconcileStoredList stored spelling from an earlier rejected item', () => {
    it('treats a mixed-case stored spelling of a submitted bech32 address as stored', () => {
        expect(MIXED).not.toBe(BTC_MAINNET);
        expect(MIXED.toLowerCase()).toBe(BTC_MAINNET);

        const out = reconcileStoredList([BTC_MAINNET], [MIXED]);

        expect(out.missing).toEqual([]);
        expect(out.unexpected).toEqual([]);
        expect(out.ok).toBe(true);
        expect(out.storedCount).toBe(1);
    });

    it('still reports a submitted bech32 address no stored spelling folds to', () => {
        const other = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
        const out = reconcileStoredList([BTC_MAINNET, other], [MIXED]);

        expect(out.missing).toEqual([other]);
        expect(out.ok).toBe(false);
    });

    it('does not fold a stored spelling onto a malformed submitted address', () => {
        const malformed = `bc1${'q'.repeat(39)}`;
        const out = reconcileStoredList([malformed], [malformed.toUpperCase()]);

        expect(out.missing).toEqual([malformed]);
        expect(out.unexpected).toEqual([malformed.toUpperCase()]);
    });

    it('leaves base58 matching exact', () => {
        const changedCase = `${BTC_LEGACY.slice(0, 2)}w${BTC_LEGACY.slice(3)}`;
        const out = reconcileStoredList([BTC_LEGACY], [changedCase]);

        expect(out.missing).toEqual([BTC_LEGACY]);
        expect(out.unexpected).toEqual([]);
    });

    it('matches an accented stored spelling by the indexer row identity', () => {
        const accented = BTC_LEGACY.replace('Donk', 'Dönk');
        const out = reconcileStoredList([BTC_LEGACY], [accented]);

        expect(accented).not.toBe(BTC_LEGACY);
        expect(out.missing).toEqual([]);
        expect(out.unexpected).toEqual([]);
        expect(out.ok).toBe(true);
    });
});
