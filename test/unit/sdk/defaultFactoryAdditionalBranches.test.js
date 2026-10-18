// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { adaptXChainSDK } from '../../../packages/core/src/sdk/defaultFactory.js';

describe('adaptXChainSDK invalid adapters', () => {
    it.each([
        ['undefined', undefined],
        ['object', {}],
        ['string', 'XChainSDK'],
    ])('rejects an %s adapter', (type, candidate) => {
        expect(() => adaptXChainSDK(candidate))
            .toThrow(`adaptXChainSDK: expected a class/function (got ${typeof candidate})`);
    });
});
