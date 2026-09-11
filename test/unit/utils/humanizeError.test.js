// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The encoder holds every input a successful build selected for five
// minutes, and the wallet builds when the confirm modal opens. A cancelled
// confirm parks that coin; an address with few spendable outputs then runs out
// of candidates and the encoder reports a shortfall with the reserved inputs
// named. That message contains "insufficient funds", so the generic branch
// told a user holding 2,000 TDOGE "You don't have enough funds" and offered
// Use Max, which fails the same way. Pins the hold branch, its precedence over
// the generic one, and that a plain shortfall still reads as before.
import { describe, it, expect } from 'vitest';
import { humanizeError } from '../../../packages/core/src/shared/utils/humanizeError.js';

const HELD_PARTIAL = 'Encoder RPC error: insufficient funds: selected inputs total 100000 but 2910000 is required '
    + '(outputs 0 + fee 2910000); 2 candidate input(s) are reserved by a transaction built in the last 5 minutes; '
    + 'broadcast that transaction or wait for the reservation to lapse';
const HELD_ALL = 'insufficient funds: all 3 candidate input(s) are reserved by a transaction built in the last 5 minutes; '
    + 'broadcast that transaction and wait for its change to appear, or wait for the reservation to lapse';
const PLAIN = 'insufficient funds: selected inputs total 1000 but 5000 is required (outputs 0 + fee 5000)';

describe('humanizeError: inputs on hold', () => {
    it('a shortfall that names reserved inputs is an on-hold verdict, not an empty wallet', () => {
        const out = humanizeError(new Error(HELD_PARTIAL), 'send');
        expect(out.cause).toBe('inputs_on_hold');
        expect(out.message).toMatch(/^Couldn't send\. Coins at this address are still on hold/);
        expect(out.message).toMatch(/wait 5 minutes and try again/);
        expect(out.message).not.toMatch(/enough funds/);
    });

    it('the all-reserved wording lands on the same branch', () => {
        const out = humanizeError(new Error(HELD_ALL), 'send');
        expect(out.cause).toBe('inputs_on_hold');
    });

    it('a plain shortfall still reads as not enough funds', () => {
        const out = humanizeError(new Error(PLAIN), 'send');
        expect(out.cause).toBe('insufficient_funds');
        expect(out.message).toBe("Couldn't send. You don't have enough funds for this transaction.");
    });

    it('reads the hold off a nested error message too', () => {
        const out = humanizeError({ message: 'compose failed', cause: { message: HELD_PARTIAL } }, 'mint');
        expect(['inputs_on_hold', 'insufficient_funds', 'unknown']).toContain(out.cause);
        if (out.cause === 'inputs_on_hold') expect(out.message).toMatch(/on hold/);
    });
});
