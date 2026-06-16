// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the two row normalizers that map xchain-explorer
// responses (positional-array OR keyed-object) into the stable shapes
// the wallet renders against. Both endpoints — /tokens/{address}/address
// (listOwnedTokens) and /issues/{tick}/token (Genesis section) — emit
// the array shape today via XChainExplorer.js's response collapsing,
// so the wallet has to tolerate both wire formats.

import { describe, it, expect } from 'vitest';
import { normalizeTokenRow } from '../../../packages/core/src/flows/listOwnedTokens.js';
import { normalizeGenesisRow } from '../../../packages/core/src/shared/routes/ManageToken.jsx';

describe('normalizeTokenRow', () => {
    it('returns null for nullish / missing-tick rows', () => {
        expect(normalizeTokenRow(null)).toBeNull();
        expect(normalizeTokenRow(undefined)).toBeNull();
        expect(normalizeTokenRow({})).toBeNull();
        expect(normalizeTokenRow([])).toBeNull();
        // Array with no tick at position [3] is invalid
        expect(normalizeTokenRow([1, 2, 3])).toBeNull();
    });

    it('parses the explorer-collapsed positional array shape', () => {
        // [count_reverse, block_index, timestamp, tick, supply,
        //  max_supply, max_mint, locks, id]
        const row = normalizeTokenRow([
            1,
            800123,
            1700000000,
            'PEPECASH',
            '125000000000000',
            '500000000000000',
            '0',
            '0|0|0|0|0|0|0',
            42,
        ]);
        expect(row).toEqual({
            tick: 'PEPECASH',
            supply: '125000000000000',
            maxSupply: '500000000000000',
            description: null,
            locked: false,
            divisibility: null,
        });
    });

    it('flags locked when any of the first three lock bits is set', () => {
        // lock_max_supply on
        const a = normalizeTokenRow([1, 1, 1, 'A', '1', '1', '0', '1|0|0|0|0|0|0', 1]);
        // lock_mint on
        const b = normalizeTokenRow([1, 1, 1, 'B', '1', '1', '0', '0|1|0|0|0|0|0', 1]);
        // lock_mint_supply on
        const c = normalizeTokenRow([1, 1, 1, 'C', '1', '1', '0', '0|0|1|0|0|0|0', 1]);
        // lock_description on (not a "locked" supply state)
        const d = normalizeTokenRow([1, 1, 1, 'D', '1', '1', '0', '0|0|0|0|1|0|0', 1]);
        expect(a.locked).toBe(true);
        expect(b.locked).toBe(true);
        expect(c.locked).toBe(true);
        expect(d.locked).toBe(false);
    });

    it('parses the keyed-object shape with divisibility (dev mock + future explorer)', () => {
        const row = normalizeTokenRow({
            tick: 'XCHAINGOV',
            supply: '125000000000',
            max_supply: '125000000000',
            description: 'Vote on proposals.',
            locked: true,
            divisibility: 8,
        });
        expect(row).toEqual({
            tick: 'XCHAINGOV',
            supply: '125000000000',
            maxSupply: '125000000000',
            description: 'Vote on proposals.',
            locked: true,
            divisibility: 8,
        });
    });

    it('accepts the legacy `decimals` alias for divisibility', () => {
        const row = normalizeTokenRow({ tick: 'L', supply: '1', decimals: 6 });
        expect(row.divisibility).toBe(6);
    });

    it('keyed shape: locks can arrive as individual columns or a pipe string', () => {
        const fromColumn = normalizeTokenRow({ tick: 'A', lock_mint: '1' });
        const fromString = normalizeTokenRow({ tick: 'B', locks: '0|0|1|0|0|0|0' });
        expect(fromColumn.locked).toBe(true);
        expect(fromString.locked).toBe(true);
    });

    it('keyed shape: aggregate `locked` boolean still wins', () => {
        const row = normalizeTokenRow({ tick: 'A', locked: true });
        expect(row.locked).toBe(true);
    });
});

describe('normalizeGenesisRow', () => {
    it('returns null for nullish input', () => {
        expect(normalizeGenesisRow(null)).toBeNull();
        expect(normalizeGenesisRow(undefined)).toBeNull();
    });

    it('parses the explorer-collapsed positional array shape', () => {
        // [count, block_index, timestamp, source, tick, max_supply,
        //  max_mint, locks, status, action_index]
        const out = normalizeGenesisRow([
            1,
            800001,
            1700000000,
            'bc1qissuer',
            'PEPECASH',
            '125000000000000',
            '0',
            '0|0|0|0|0|0|0',
            'CONFIRMED',
            '800001.42',
        ]);
        expect(out).toEqual({
            blockIndex: 800001,
            timestamp: 1700000000,
            source: 'bc1qissuer',
            actionIndex: '800001.42',
        });
    });

    it('parses the keyed-object shape and prefers timestamp over block_time', () => {
        const out = normalizeGenesisRow({
            block_index: '800001',
            timestamp: 1700000000,
            block_time: 1699999999,
            source: 'bc1qissuer',
            action_index: '800001.42',
        });
        expect(out).toEqual({
            blockIndex: 800001,
            timestamp: 1700000000,
            source: 'bc1qissuer',
            actionIndex: '800001.42',
        });
    });

    it('falls back to block_time + actionIndex when the primaries are absent', () => {
        const out = normalizeGenesisRow({
            block_index: 800001,
            block_time: 1699999999,
            actionIndex: 7,
        });
        expect(out.timestamp).toBe(1699999999);
        expect(out.actionIndex).toBe('7');
    });
});
