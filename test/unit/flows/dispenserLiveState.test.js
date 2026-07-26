// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: D-39. DispenserDetail read live status from `current_status`, a
// column the by-action-index read path does not return - it puts the live
// values in a `state` block. So liveStatus stayed at the create status
// ('valid'), isOpen was never true, and Close / Refill / Edit were disabled
// on every real dispenser: the whole owner lifecycle was unreachable from
// the wallet. Observed live on regtest against dispenser #3442, whose
// action response carried state.status 'open' and give_remaining 200.

import { describe, it, expect } from 'vitest';
import { dispenserLiveState } from '../../../packages/core/src/flows/dispenserQueries.js';

// The live shape: create columns frozen at creation, live values in `state`.
const openDispenser = {
    action_index: '3442',
    status: 'valid',
    expiration: '1798747200',
    allow_list: null,
    block_list: null,
    state: {
        status: 'open',
        give_remaining: '200',
        expiration: '1798747200',
        allow_list: null,
        block_list: null,
    },
};

describe('dispenserLiveState', () => {
    it('prefers the state block over the frozen create status', () => {
        expect(dispenserLiveState(openDispenser).status).toBe('open');
    });

    it('surfaces the close window, which the create status can never show', () => {
        const closing = { ...openDispenser, state: { ...openDispenser.state, status: 'cancelling' } };
        expect(dispenserLiveState(closing).status).toBe('cancelling');
    });

    it('reports escrow left after fills, not the amount escrowed at create', () => {
        expect(dispenserLiveState(openDispenser).giveRemaining).toBe('200');
    });

    it('takes an EDITED expiration and lists over the create ones', () => {
        const edited = {
            ...openDispenser,
            expiration: '1798747200',
            allow_list: null,
            state: { ...openDispenser.state, expiration: '1900000000', allow_list: 'bcrt1qedited' },
        };
        const live = dispenserLiveState(edited);
        expect(live.expiration).toBe('1900000000');
        expect(live.allowList).toBe('bcrt1qedited');
    });

    it('falls back to current_status on a list-lane row that has no state block', () => {
        expect(dispenserLiveState({ status: 'valid', current_status: 'closed' }).status).toBe('closed');
    });

    it('falls back to the create status for demo fixtures carrying only that', () => {
        expect(dispenserLiveState({ status: 'open' }).status).toBe('open');
    });

    it('never throws on a missing dispenser', () => {
        expect(dispenserLiveState(null)).toEqual({
            status: '', expiration: undefined, allowList: undefined, blockList: undefined, giveRemaining: null,
        });
    });
});
