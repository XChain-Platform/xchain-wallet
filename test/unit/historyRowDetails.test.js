// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the explorer nests per-action fields under `details`, and History read
// them at the top level.
//
// The helper's own behaviour is the small half. The half worth having is the
// two USER-VISIBLE consequences, pinned here against the nested row shape the
// explorer actually publishes: Grouped mode silently never grouped, and the
// payload search silently matched nothing. Both are tested BOTH WAYS - nested
// (the defect) and flattened (the fix) - because a test that only asserts the
// fixed direction would still pass if the flatten were dropped and the fields
// happened to appear top-level in some other fixture.

import { describe, it, expect } from 'vitest';
import { flattenActionDetails } from '../../packages/core/src/shared/utils/historyRow.js';
import { groupHistoryEntries } from '../../packages/core/src/shared/utils/historyGrouping.js';
import { applyHistoryFilters } from '../../packages/core/src/shared/utils/historyFilter.js';

const SOURCE = 'rltc1qhd7ckhwm0ln5hy4qy8yy3z8v4r7g4mrqz4wq9d';

/**
 * A history row shaped the way `projectActionSummary` publishes it: identity
 * and status at the top level, everything else under `details`.
 */
function explorerRow(action, actionIndex, details) {
    return {
        action,
        action_index: String(actionIndex),
        block_index: '7804',
        timestamp: '1787880118',
        tx_hash: `deadbeef${actionIndex}`,
        status: 'valid',
        details: { action_format: 0, action_index: String(actionIndex), ...details },
    };
}

/** The entry History.jsx builds around a row, with `raw` under our control. */
function entryFor(row, raw) {
    return {
        key: `litecoin-regtest:${row.action_index}:${SOURCE}`,
        chainId: 'litecoin-regtest',
        address: SOURCE,
        actionIndex: String(row.action_index),
        action: row.action,
        blockIndex: Number(row.block_index),
        timestamp: Number(row.timestamp),
        txHash: row.tx_hash,
        source: String(raw.source ?? ''),
        raw,
        link: null,
    };
}

const ISSUE_ROW = explorerRow('ISSUE', 4001, { tick: 'CAMPA', source: SOURCE, amount: '1000' });
const MINT_ROW = explorerRow('MINT', 4002, { tick: 'CAMPA', source: SOURCE, amount: '50' });
// TWO mints, because `groupHistoryEntries` deliberately suppresses a
// single-child group: an ISSUE plus one MINT renders as two flat rows on
// purpose, since expanding a group to show one child is the same information
// behind an extra click. A one-mint fixture therefore cannot tell a working
// grouper from a broken one, which is worth knowing before writing the e2e
// fixture for this.
const MINT_ROW_2 = explorerRow('MINT', 4003, { tick: 'CAMPA', source: SOURCE, amount: '25' });

describe('flattenActionDetails', () => {
    it('lifts the fields the explorer nested, which is the whole defect', () => {
        const flat = flattenActionDetails(ISSUE_ROW);
        expect(flat.tick, 'a nested tick must be readable at the top level').toBe('CAMPA');
        expect(flat.source).toBe(SOURCE);
        expect(flat.amount).toBe('1000');
        expect(flat.status, 'the row own fields survive').toBe('valid');
    });

    it('never overwrites a top-level value that is already there', () => {
        const row = { action: 'SEND', source: 'top-level-wins', details: { source: 'nested-loses' } };
        expect(flattenActionDetails(row).source).toBe('top-level-wins');
    });

    it('treats an empty top-level string as absent, and ignores nulls in details', () => {
        const row = { source: '', details: { source: SOURCE, destination: null, tick: 'CAMPA' } };
        const flat = flattenActionDetails(row);
        expect(flat.source, 'an empty string is what the source chip rendered as a dash').toBe(SOURCE);
        expect(flat.destination, 'a null in details must not manufacture a value').toBeUndefined();
        expect(flat.tick).toBe('CAMPA');
    });

    it('leaves a row with no details object alone', () => {
        const flat = { action: 'SEND', tick: 'CAMPA' };
        expect(flattenActionDetails(flat)).toBe(flat);
        expect(flattenActionDetails({ ...flat, details: null })).toEqual({ ...flat, details: null });
        expect(flattenActionDetails(null)).toBeNull();
    });

    it('does not mutate the row it was handed', () => {
        const row = explorerRow('ISSUE', 4003, { tick: 'CAMPA', source: SOURCE });
        flattenActionDetails(row);
        expect(row.tick, 'the original row must be untouched').toBeUndefined();
    });
});

describe('Grouped mode against the row shape the explorer publishes', () => {
    it('NESTED: an ISSUE and its MINT do not group, which is the silent defect', () => {
        const entries = [MINT_ROW_2, MINT_ROW, ISSUE_ROW].map((r) => entryFor(r, r));
        const out = groupHistoryEntries(entries, 'grouped');
        // Three plain entries and no group: Grouped mode returned the flat list
        // and said nothing about it.
        expect(out.every((o) => o.kind === 'entry')).toBe(true);
        expect(out).toHaveLength(3);
    });

    it('FLATTENED: the same rows group as issue-mint', () => {
        const entries = [MINT_ROW_2, MINT_ROW, ISSUE_ROW].map((r) => entryFor(r, flattenActionDetails(r)));
        const out = groupHistoryEntries(entries, 'grouped');
        const groups = out.filter((o) => o.kind === 'group');
        expect(groups, 'the ISSUE and its MINTs share a tick and a source').toHaveLength(1);
        expect(groups[0].subkind).toBe('issue-mint');
        // Two mints plus the ISSUE leader, which the grouper appends last so
        // the expanded list reads newest-first.
        expect(groups[0].members).toHaveLength(3);
        expect(groups[0].leader.actionIndex).toBe('4001');
        expect(out.filter((o) => o.kind === 'entry'), 'nothing is left loose').toHaveLength(0);
    });
});

describe('Payload search against the row shape the explorer publishes', () => {
    const search = (entries, q) => applyHistoryFilters(entries, { searchQuery: q });

    it('NESTED: a tick that is only in details is unsearchable', () => {
        const entries = [entryFor(ISSUE_ROW, ISSUE_ROW)];
        expect(search(entries, 'CAMPA'), 'this is the search returning nothing for real history')
            .toHaveLength(0);
    });

    it('FLATTENED: the same query finds it', () => {
        const entries = [entryFor(ISSUE_ROW, flattenActionDetails(ISSUE_ROW))];
        expect(search(entries, 'CAMPA')).toHaveLength(1);
        expect(search(entries, 'campa'), 'search is case-insensitive').toHaveLength(1);
        expect(search(entries, 'NOSUCHTICK')).toHaveLength(0);
    });

    it('FLATTENED: a destination is searchable too, and action/txid still are', () => {
        const row = explorerRow('SEND', 4010, { tick: 'CAMPA', source: SOURCE, destination: 'rltc1qdest0000' });
        const entries = [entryFor(row, flattenActionDetails(row))];
        expect(search(entries, 'rltc1qdest')).toHaveLength(1);
        expect(search(entries, 'SEND')).toHaveLength(1);
        expect(search(entries, 'deadbeef4010')).toHaveLength(1);
    });
});
