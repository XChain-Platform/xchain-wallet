// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-147: the refill counter, and the two things it must not get wrong.
//
// A dispenser takes at most 5 refills; the sixth is rejected on chain. The
// refill lane has no confirm screen and owes no protocol fee, so nothing
// dry-runs it - measured live on Litecoin regtest, the wallet signed and
// broadcast a sixth refill (DISPENSER_EDIT 1683, `invalid: MAX_REFILLS`) and
// showed a "Refill submitted" screen with a transaction id for an escrow that
// never moved.
//
// The counter is therefore the only protection, which makes both directions
// expensive: under-counting lets the doomed transaction out again, and
// over-counting refuses a refill the chain would have taken.

import { describe, it, expect } from 'vitest';
import {
    MAX_REFILLS,
    isRefillEdit,
    refillsUsed,
    refillCeilingMessage,
} from '../../../packages/core/src/shared/utils/dispenserRefills.js';

/** A lifecycle event as DispenserDetail holds it. */
const ev = (row) => ({ kind: 'edits', row });

/** A refill row as a CURRENT explorer serves it. */
const refill = (extra = {}) => ({
    action: 'DISPENSER_EDIT', action_format: 2, dispenser_action_index: '1677',
    give_escrow: '20', expiration: null, allow_list: null, block_list: null,
    status: 'valid', ...extra,
});

/** An expiration edit: same action, not a refill. */
const reschedule = (extra = {}) => refill({ give_escrow: null, expiration: '1798228800', ...extra });

describe('D-147: counting a dispenser\'s refills', () => {
    it('counts refills and ignores expiration and list edits', () => {
        const count = refillsUsed([
            ev(refill()), ev(reschedule()), ev(refill()),
            ev(refill({ give_escrow: null, allow_list: '1620' })),
        ]);
        expect(count.used).toBe(2);
        expect(count.remaining).toBe(MAX_REFILLS - 2);
        expect(count.exact, 'every row carried give_escrow, so the count is not inferred')
            .toBe(true);
    });

    // The chain charges the cap on what it ACCEPTED. Counting a rejected sixth
    // would leave the owner permanently one short of a ceiling they never
    // reached, on a dispenser they cannot fix.
    it('does not count edits the chain rejected', () => {
        const count = refillsUsed([
            ev(refill()),
            ev(refill({ status: 'invalid: MAX_REFILLS (dispenser refill limit reached)' })),
            ev(refill({ status: 'invalid: insufficient funds' })),
        ]);
        expect(count.used).toBe(1);
    });

    it('ignores events that are not edits at all', () => {
        const count = refillsUsed([
            ev(refill()),
            { kind: 'closes', row: { status: 'valid' } },
            { kind: 'dispenses', row: { status: 'valid' } },
            { kind: 'cancels', row: { status: 'valid' } },
        ]);
        expect(count.used).toBe(1);
    });

    it('reports a spent ceiling with nothing left', () => {
        const count = refillsUsed(Array.from({ length: MAX_REFILLS }, () => ev(refill())));
        expect(count.used).toBe(MAX_REFILLS);
        expect(count.remaining).toBe(0);
        expect(refillCeilingMessage(count)).toMatch(/used all 5/);
        expect(refillCeilingMessage(count),
            'the copy does not say what a refill now would cost')
            .toMatch(/transaction fee/);
    });

    // An explorer older than the give_escrow column serves the other three
    // fields and nothing else, so the count is inferred: a v2 edit that touched
    // no expiration and no list touched the escrow. It is marked inexact
    // because a no-op edit would be miscounted, and DispenserDetail only
    // BLOCKS on an exact count.
    it('infers refills when the venue serves no escrow amount, and says so', () => {
        const legacy = (extra = {}) => ({
            action: 'DISPENSER_EDIT', action_format: 2, dispenser_action_index: '1677',
            expiration: null, allow_list: null, block_list: null, status: 'valid', ...extra,
        });
        const count = refillsUsed([
            ev(legacy()), ev(legacy()), ev(legacy({ expiration: '1798228800' })),
        ]);
        expect(count.used, 'the two escrow-only edits are refills; the reschedule is not').toBe(2);
        expect(count.exact).toBe(false);
        expect(refillCeilingMessage(count),
            'an inferred count must not be presented as a fact').toMatch(/approximate/);
    });

    it('one unserved row makes the whole count inferred', () => {
        const mixed = refillsUsed([
            ev(refill()),
            ev({ action: 'DISPENSER_EDIT', expiration: null, allow_list: null, block_list: null, status: 'valid' }),
        ]);
        expect(mixed.exact).toBe(false);
    });

    it('an untouched dispenser has every refill available', () => {
        const count = refillsUsed([]);
        expect(count).toMatchObject({ used: 0, remaining: MAX_REFILLS, exact: true });
        expect(refillCeilingMessage(count)).toMatch(/0 of 5 refills used, 5 left/);
    });

    it('treats a zero or empty escrow as not a refill', () => {
        // The indexer charges the cap on `GIVE_ESCROW > 0`, so a zero must not
        // burn one of the five.
        expect(isRefillEdit(refill({ give_escrow: '0' }))).toBe(false);
        expect(isRefillEdit(refill({ give_escrow: '' }))).toBe(false);
        expect(isRefillEdit(refill({ give_escrow: null }))).toBe(false);
        expect(isRefillEdit(refill({ give_escrow: '0.00000001' }))).toBe(true);
    });
});
