// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    watchNetwork,
    watchWalletName,
} from '../../../packages/core/src/watch/buildWatchTotals.js';

describe('watchNetwork', () => {
    it.each([
        ['mainnet', false],
        ['testnet', true],
        ['regtest', true],
    ])('maps %s to its watch network flags', (activeNetwork, isTest) => {
        expect(watchNetwork({ activeNetwork })).toEqual({ kind: activeNetwork, isTest });
    });

    it('defaults an absent network to mainnet', () => {
        expect(watchNetwork({})).toEqual({ kind: 'mainnet', isTest: false });
        expect(watchNetwork()).toEqual({ kind: 'mainnet', isTest: false });
    });

    it('defaults an unknown network to mainnet', () => {
        expect(watchNetwork({ activeNetwork: 'signet' })).toEqual({
            kind: 'mainnet',
            isTest: false,
        });
    });
});

describe('watchWalletName', () => {
    it('trims a wallet name', () => {
        expect(watchWalletName('  Daily wallet  ')).toBe('Daily wallet');
    });

    it('cuts a 41-unit name to 40 UTF-16 units', () => {
        expect(watchWalletName('a'.repeat(41))).toBe('a'.repeat(40));
    });

    it('does not split an emoji that straddles unit 40', () => {
        const name = `${'a'.repeat(39)}😀`;
        const result = watchWalletName(name);

        expect(result).toBe('a'.repeat(39));
        expect(result).toHaveLength(39);
        expect([...result]).toHaveLength(39);
    });

    it('returns undefined for a blank or non-string name', () => {
        expect(watchWalletName('  \n\t  ')).toBeUndefined();
        expect(watchWalletName()).toBeUndefined();
        expect(watchWalletName(42)).toBeUndefined();
    });
});
