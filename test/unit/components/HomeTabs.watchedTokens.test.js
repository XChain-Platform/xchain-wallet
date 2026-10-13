// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { buildWatchedTokenRows } from '../../../packages/core/src/shared/components/HomeTabs.jsx';

describe('HomeTabs watched tokens', () => {
    it('adds chain-scoped zero-balance rows immediately and skips tokens already in balances', () => {
        const existing = [{
            chainId: 'bitcoin-mainnet',
            tick: 'SAME',
            kind: 'token',
            quantity: '25',
        }];

        const rows = buildWatchedTokenRows([
            'bitcoin-mainnet:SAME',
            'dogecoin-mainnet:SAME',
            'dogecoin-mainnet:SAME',
            'unknown-mainnet:NOPE',
            'malformed',
        ], existing, defaultRegistry());

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            chainId: 'dogecoin-mainnet',
            tick: 'SAME',
            kind: 'token',
            quantity: '0',
        });
    });
});
