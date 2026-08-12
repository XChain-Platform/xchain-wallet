// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: from-address (SOURCE) selection for action forms. The point of
// interest is that the change/index tail is read END-relative, so both a
// BIP44 path (m/purpose'/coin'/account'/change/index) and a
// counterwallet-legacy path (m/0'/change/index) resolve. Reading change at
// the fixed position [4] matched nothing on a legacy wallet, which made
// every action form report "No address on this chain" for a wallet that was
// funded and had three addresses.

import { describe, it, expect } from 'vitest';
import {
    externalIndexOf,
    newestHdExternalId,
    activeSourceId,
    preferredSourceId,
} from '../../../packages/core/src/shared/addressSelection.js';

const hd = (id, derivationPath, over = {}) => ({
    id, address: `addr_${id}`, source: 'hd', derivationPath, ...over,
});

describe('externalIndexOf', () => {
    it('reads the index off a BIP44 external path', () => {
        expect(externalIndexOf("m/84'/0'/0'/0/7")).toBe(7);
    });

    it('reads the index off a counterwallet-legacy external path', () => {
        expect(externalIndexOf("m/0'/0/3")).toBe(3);
    });

    it('rejects internal (change=1) paths in both shapes', () => {
        expect(externalIndexOf("m/84'/0'/0'/1/7")).toBeNull();
        expect(externalIndexOf("m/0'/1/3")).toBeNull();
    });

    it('rejects missing, short and non-numeric paths', () => {
        expect(externalIndexOf(undefined)).toBeNull();
        expect(externalIndexOf('')).toBeNull();
        expect(externalIndexOf('m/0')).toBeNull();
        expect(externalIndexOf("m/0'/0/notanumber")).toBeNull();
    });
});

describe('newestHdExternalId', () => {
    it('picks the highest index on a BIP44 wallet', () => {
        const id = newestHdExternalId([
            hd('a', "m/84'/0'/0'/0/0"),
            hd('c', "m/84'/0'/0'/0/2"),
            hd('b', "m/84'/0'/0'/0/1"),
        ]);
        expect(id).toBe('c');
    });

    it('picks the highest index on a counterwallet-legacy wallet', () => {
        // Before this returned null: no path had a segment at [4],
        // so the whole set was filtered away and the form showed the
        // "no address on this chain" error on a funded wallet.
        const id = newestHdExternalId([
            hd('legacy0', "m/0'/0/0"),
            hd('legacy1', "m/0'/0/1"),
        ]);
        expect(id).toBe('legacy1');
    });

    it('ignores internal addresses and non-hd sources', () => {
        expect(newestHdExternalId([
            hd('change', "m/0'/1/9"),
            hd('imported', "m/0'/0/5", { source: 'imported-wif' }),
        ])).toBeNull();
    });

    it('returns null on an empty or missing set', () => {
        expect(newestHdExternalId([])).toBeNull();
        expect(newestHdExternalId(null)).toBeNull();
    });
});

describe('preferredSourceId', () => {
    const addrs = [hd('legacy0', "m/0'/0/0"), hd('legacy1', "m/0'/0/1")];

    it('prefers the active address when it is in the set', () => {
        expect(preferredSourceId(addrs, { id: 'legacy0' })).toBe('legacy0');
    });

    it('falls back to the newest external address on a legacy wallet', () => {
        expect(preferredSourceId(addrs, undefined)).toBe('legacy1');
    });

    it('matches an active entry by address string too', () => {
        expect(activeSourceId(addrs, { address: 'addr_legacy0' })).toBe('legacy0');
    });
});
