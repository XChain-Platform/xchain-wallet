// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An unreadable token ledger reaches the simulator as an unknown marker, so a
// token preview never starts from a balance of zero that nobody read.

import { describe, expect, it } from 'vitest';
import { balancesFromSdk } from '../../../packages/core/src/decoder/balanceAdapter.js';
import { simulateAction } from '../../../packages/core/src/decoder/txSimulator.js';

const NATIVE = { tick: 'BTC', quantity: '100000000', divisibility: 8 };

describe('balancesFromSdk with an unreadable token ledger', () => {
    it('emits a tickless unknown token marker', () => {
        expect(balancesFromSdk({ native: NATIVE, tokens: [], unavailable: ['tokens'] })).toEqual([
            { tick: 'BTC', amount: '1', isCoin: true },
            { tick: '', amount: '', isCoin: false, unknown: true },
        ]);
    });

    it('emits both markers when neither half could be read', () => {
        expect(balancesFromSdk({ native: null, tokens: [], unavailable: ['native', 'tokens'] })).toEqual([
            { tick: '', amount: '', isCoin: true, unknown: true },
            { tick: '', amount: '', isCoin: false, unknown: true },
        ]);
    });

    it('emits no token marker when only the coin half could not be read', () => {
        const rows = balancesFromSdk({ native: null, tokens: [], unavailable: ['native'] });
        expect(rows.some((row) => !row.isCoin)).toBe(false);
    });

    it('emits no token marker for a ledger that was read and is empty', () => {
        expect(balancesFromSdk({ native: NATIVE, tokens: [] })).toEqual([
            { tick: 'BTC', amount: '1', isCoin: true },
        ]);
    });
});

describe('simulateAction with an unreadable token ledger', () => {
    const send = (balances) => simulateAction({
        action: 'SEND',
        params: { TICK: 'XCP', AMOUNT: '5' },
        balances,
        feeEstimate: '0.001',
    });

    it('shows the token balance as unknown instead of projecting it from zero', () => {
        const out = send(balancesFromSdk({ native: NATIVE, tokens: [], unavailable: ['tokens'] }));
        const row = out.deltas.find((delta) => delta.tick === 'XCP');
        expect(row).toMatchObject({ before: '', after: '', beforeUnknown: true, afterUnknown: true });
        expect(out.notes.join(' ')).toMatch(/XCP balance could not be read/);
    });

    it('leaves the readable coin balance alone', () => {
        const out = send(balancesFromSdk({ native: NATIVE, tokens: [], unavailable: ['tokens'] }));
        const coin = out.deltas.find((delta) => delta.tick === 'BTC' && delta.isCoin && !delta.isFee);
        expect(coin?.beforeUnknown).toBeUndefined();
    });

    it('still projects a token from a ledger that was read and holds none', () => {
        const out = send(balancesFromSdk({ native: NATIVE, tokens: [] }));
        const row = out.deltas.find((delta) => delta.tick === 'XCP');
        expect(row).toMatchObject({ before: '0', after: '-5' });
        expect(row.beforeUnknown).toBeUndefined();
    });
});
