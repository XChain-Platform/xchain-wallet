// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Escrow rows on Home. A token whose whole balance sits in the user's own open
// offer has no free balance, so the explorer drops it; Home merges the escrow
// in as `balances.escrow` and the row must survive every filter that treats a
// zero row as noise (the spam nudge, hide-small-balances).

import { describe, it, expect } from 'vitest';
import {
    buildBalanceRows, detectSpamCandidates, isSmallBalanceRow,
} from '../../../packages/core/src/shared/components/BalanceList.jsx';
import { escrowTargets, mergeEscrow } from '../../../packages/core/src/shared/hooks/useEscrowedBalances.js';

const chainRegistry = {
    get: (chainId) => (chainId === 'litecoin-testnet'
        ? { id: 'litecoin-testnet', coin: 'litecoin', displayName: 'Litecoin' }
        : null),
};

const OWNER = 'tltc1ql05c4je6cjg5ejzyrrr2nxvdr7htmf5eelek37';

// The live shape for the TLTC report: 420, Charlie_Lee and GFL free, BEER absent.
const balances = {
    'litecoin-testnet': [{
        address: OWNER,
        balances: {
            native: { quantity: '994725651', divisibility: 8, tick: 'LTC' },
            tokens: [
                { tick: '420', quantity: '420', divisibility: 0 },
                { tick: 'GFL', quantity: '1009723010101010', divisibility: 8 },
            ],
        },
    }],
};

describe('buildBalanceRows with escrow', () => {

    const merged = mergeEscrow(balances, {
        [`litecoin-testnet:${OWNER}`]: [
            { tick: 'BEER', amount: '12' },
            { tick: 'GFL', amount: '0.5' },
        ],
    });
    const rows = buildBalanceRows(merged, chainRegistry);
    const byTick = Object.fromEntries(rows.map((r) => [r.tick, r]));

    it('gives a fully escrowed token a row at zero free with its escrow', () => {
        expect(byTick.BEER).toMatchObject({ kind: 'token', quantity: '0', escrowed: '12', divisibility: 0 });
    });

    it('adds escrow to a token that also has a free balance, leaving the free amount alone', () => {
        expect(byTick.GFL).toMatchObject({ quantity: '1009723010101010', escrowed: '0.5' });
        expect(byTick['420'].escrowed).toBeUndefined();
    });

    it('keeps the escrowed row out of the spam nudge and the small-balance fold', () => {
        expect(detectSpamCandidates(rows)).not.toContain(`litecoin-testnet:BEER`);
        expect(isSmallBalanceRow(byTick.BEER)).toBe(false);
        // An ordinary zero row is still both, so the exemption is escrow's alone.
        const bare = { ...byTick.BEER, escrowed: undefined };
        expect(detectSpamCandidates([bare])).toEqual([`litecoin-testnet:BEER`]);
        expect(isSmallBalanceRow(bare)).toBe(true);
    });

    it('is unchanged without escrow', () => {
        expect(mergeEscrow(balances, {})).toBe(balances);
        expect(buildBalanceRows(balances, chainRegistry).some((r) => r.tick === 'BEER')).toBe(false);
    });

});

describe('escrowTargets', () => {

    it('reads only the active address where one is set', () => {
        const two = { 'litecoin-testnet': [{ address: 'a' }, { address: 'b' }] };
        expect(escrowTargets(two, { 'litecoin-testnet': { address: 'b' } }))
            .toEqual([{ chainId: 'litecoin-testnet', address: 'b' }]);
    });

    it('reads each distinct address, capped, when the whole account is shown', () => {
        const many = { c: Array.from({ length: 14 }, (_, i) => ({ address: `a${i % 12}` })) };
        const t = escrowTargets(many, {});
        expect(t).toHaveLength(10);
        expect(new Set(t.map((x) => x.address)).size).toBe(10);
    });

});
