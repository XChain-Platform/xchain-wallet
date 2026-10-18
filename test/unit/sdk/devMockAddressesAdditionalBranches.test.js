// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    isDevMockAddress,
    mockDeriveAddress,
} from '../../../packages/core/src/sdk/devMockAddresses.js';

describe('mockDeriveAddress fallback branches', () => {
    it('uses the Bitcoin p2pkh fallback for an unknown chain and omitted type', () => {
        const address = mockDeriveAddress('unknown-mainnet', undefined, 'A1B2C3');

        expect(address).toBe('1devmocka1b2c3');
        expect(isDevMockAddress(address)).toBe(true);
    });

    it('marks an unsupported address type instead of presenting it as a known mock address', () => {
        const address = mockDeriveAddress('bitcoin-mainnet', 'p2wsh', 'ABCDEF');

        expect(address).toBe('p2wsh:abcdef');
        expect(isDevMockAddress(address)).toBe(false);
    });

    it('normalizes and truncates a truthy public-key tail', () => {
        const address = mockDeriveAddress('bitcoin-mainnet', 'p2pkh', 'ABCDEF'.repeat(8));

        expect(address).toBe(`1devmock${'abcdef'.repeat(4)}`);
    });
});
