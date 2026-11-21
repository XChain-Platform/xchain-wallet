// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import {
    assertDestroyAllowedOnChain,
    destroyRefusalFor,
} from '../../../../packages/core/src/registry/destroyPolicy.js';
import { advancedAction } from '../../../../packages/core/src/flows/advancedAction.js';
import { buildBatchCommand } from '../../../../packages/core/src/flows/batchCommand.js';

const registry = {
    get: (id) => ({ coin: String(id).split('-')[0] }),
};

describe('destroy policy', () => {
    it.each([
        ['XCHAIN', 'bitcoin', null],
        ['xchain', 'BTC', null],
        ['XCHAIN', 'litecoin', 'use-xbridge-v1'],
        ['XCHAIN', 'DOGE', 'use-xbridge-v1'],
        ['BTC.PEPECASH', 'dogecoin', 'use-xbridge-v4'],
        ['btc.pepecash', 'DOGE', 'use-xbridge-v4'],
        ['DOGE.FOO', 'dogecoin', null],
        ['BTC.PEPE.CASH', 'dogecoin', null],
        ['PEPECASH', 'dogecoin', null],
    ])('classifies %s on %s', (tick, sourceCoin, rule) => {
        expect(destroyRefusalFor({ tick, sourceCoin })?.rule || null).toBe(rule);
    });

    it('checks every supplied tick', () => {
        expect(() => assertDestroyAllowedOnChain(
            registry,
            'dogecoin-mainnet',
            ['DOGE.FOO', 'BTC.PEPE'],
            'test',
        )).toThrow(/Use Move/);
    });

    it('refuses a generic DESTROY before submission', async () => {
        const run = advancedAction({
            chainRegistry: registry,
            sdkRegistry: {},
            chainId: 'litecoin-mainnet',
            from: { address: 'addr', publicKey: '02ab', addressId: 'a1' },
            action: 'destroy',
            params: { TICK: 'XCHAIN', AMOUNT: '1' },
        });
        await expect(run).rejects.toThrow(/Use Move/);
    });

    it('refuses a nested DESTROY before the batch builder adds it', async () => {
        const builder = { add: vi.fn(), build: vi.fn() };
        const run = buildBatchCommand({
            sdkRegistry: { get: () => ({ batch: () => builder }) },
            chainRegistry: registry,
            chainId: 'dogecoin-mainnet',
            subActions: [{ action: 'DESTROY', params: { TICK: 'BTC.PEPE', AMOUNT: '1' } }],
        });
        await expect(run).rejects.toThrow(/Use Move/);
        expect(builder.add).not.toHaveBeenCalled();
    });
});
