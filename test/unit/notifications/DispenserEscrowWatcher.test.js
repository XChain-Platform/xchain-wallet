// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// PC-46: the dispenser low-escrow watcher.
//
// The properties worth pinning: the alert is measured in DISPENSES (escrow
// alone says nothing without the per-dispense amount), the remaining escrow
// comes from the action detail rather than the listing, and a dispenser that
// slides from low to empty announces a SECOND time - keying on the id alone
// would say "running low" once and then go quiet through the moment it
// actually ran dry.

import { describe, it, expect, vi } from 'vitest';
import { DispenserEscrowWatcher } from '../../../packages/core/src/notifications/DispenserEscrowWatcher.js';

/**
 * @param rows    dispenser listing rows
 * @param details actionIndex -> action detail (carries state.give_remaining)
 */
function makeSdk(rows, details) {
    return {
        getDispensers: async () => ({ data: rows }),
        getAction: async (idx) => details[String(idx)] ?? null,
    };
}

const listing = (over = {}) => ({
    action_index: '2592', status: 'valid', give_amount: '10', give_tick: 'XCHAIN', ...over,
});
const detail = (giveRemaining, status = 'open') => ({
    state: { give_remaining: String(giveRemaining), status },
});

function makeWatcher(sdk, overrides = {}) {
    const notify = vi.fn();
    const watcher = new DispenserEscrowWatcher({
        getActiveAddresses: async () => [{ chainId: 'bitcoin-regtest', address: 'bcrt1qmine', label: 'BTC regtest' }],
        getSdkForChain: () => sdk,
        getSettings: async () => ({ notifications: {} }),
        notify,
        ...overrides,
    });
    return { watcher, notify };
}

describe('DispenserEscrowWatcher', () => {
    it('warns in dispenses remaining, not raw escrow', async () => {
        // 25 escrow at 10 per dispense = 2 more buyers.
        const { watcher, notify } = makeWatcher(makeSdk([listing()], { 2592: detail(25) }));
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        const n = notify.mock.calls[0][0];
        expect(n.body).toContain('2 more buyers');
        expect(n.data).toMatchObject({ dispensesLeft: 2, route: 'dispenser-detail', intent: 'refill' });
    });

    it('says "empty" and drops the buyer count at zero', async () => {
        const { watcher, notify } = makeWatcher(makeSdk([listing()], { 2592: detail(5) }));
        await watcher.pollOnce();
        const n = notify.mock.calls[0][0];
        expect(n.title).toContain('empty');
        expect(n.body).toContain('turning buyers away');
        expect(n.data.dispensesLeft).toBe(0);
    });

    it('stays quiet on a well-stocked dispenser', async () => {
        const { watcher, notify } = makeWatcher(makeSdk([listing()], { 2592: detail(1000) }));
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
    });

    it('announces again when a low dispenser goes empty', async () => {
        const details = { 2592: detail(25) };   // 2 left
        const sdk = makeSdk([listing()], details);
        const { watcher, notify } = makeWatcher(sdk);
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        await watcher.pollOnce();               // unchanged: silent
        expect(notify).toHaveBeenCalledTimes(1);
        details['2592'] = detail(0);            // now dry
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(2);
        expect(notify.mock.calls[1][0].title).toContain('empty');
    });

    it('re-arms after a refill so the next drop announces again', async () => {
        const details = { 2592: detail(25) };
        const sdk = makeSdk([listing()], details);
        const { watcher, notify } = makeWatcher(sdk);
        await watcher.pollOnce();
        details['2592'] = detail(5000);   // operator topped it up
        await watcher.pollOnce();
        details['2592'] = detail(25);     // drained again
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(2);
    });

    it('ignores dispensers that are closed or no longer valid', async () => {
        const { watcher, notify } = makeWatcher(makeSdk(
            [listing({ action_index: '1' }), listing({ action_index: '2', status: 'invalid: X' })],
            { 1: detail(0, 'closed'), 2: detail(0) },
        ));
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
    });

    it('skips a dispenser that gives nothing per dispense instead of dividing by zero', async () => {
        const { watcher, notify } = makeWatcher(makeSdk(
            [listing({ give_amount: '0' })], { 2592: detail(100) },
        ));
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
    });

    it('reads the same dispenser once even when several of my addresses list it', async () => {
        const sdk = makeSdk([listing()], { 2592: detail(25) });
        const spy = vi.spyOn(sdk, 'getAction');
        const { watcher, notify } = makeWatcher(sdk, {
            getActiveAddresses: async () => [
                { chainId: 'bitcoin-regtest', address: 'bcrt1qa', label: 'BTC regtest' },
                { chainId: 'bitcoin-regtest', address: 'bcrt1qb', label: 'BTC regtest' },
            ],
        });
        await watcher.pollOnce();
        expect(spy).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('survives a detail read that fails and still reports the others', async () => {
        const sdk = makeSdk(
            [listing({ action_index: '1' }), listing({ action_index: '2' })],
            { 2: detail(0) },
        );
        sdk.getAction = async (idx) => {
            if (String(idx) === '1') throw new Error('explorer down');
            return detail(0);
        };
        const { watcher, notify } = makeWatcher(sdk);
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('honours a custom low threshold', async () => {
        const { watcher, notify } = makeWatcher(makeSdk([listing()], { 2592: detail(100) }), {
            lowDispenses: 10,   // 10 left is "low" under this policy
        });
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('makes no network call while the feature is switched off', async () => {
        const sdk = makeSdk([listing()], { 2592: detail(0) });
        const spy = vi.spyOn(sdk, 'getDispensers');
        const { watcher, notify } = makeWatcher(sdk, {
            getSettings: async () => ({ notifications: { dispenserEscrow: false } }),
        });
        await watcher.pollOnce();
        expect(spy).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });

    it('defaults ON for a settings record that predates the flag', async () => {
        const { watcher, notify } = makeWatcher(makeSdk([listing()], { 2592: detail(0) }), {
            getSettings: async () => ({ notifications: { deadlines: true } }),
        });
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('never promises the refill will be accepted (the protocol caps refills)', async () => {
        const { watcher, notify } = makeWatcher(makeSdk([listing()], { 2592: detail(0) }));
        await watcher.pollOnce();
        const n = notify.mock.calls[0][0];
        // Only the refill form can state where the operator stands against the
        // 5-refill / 6,000 lifetime ceiling, so the alert must not imply one.
        expect(n.body).not.toMatch(/you can refill|refill is available|will be accepted/i);
    });

    it('requires its dependencies', () => {
        expect(() => new DispenserEscrowWatcher({})).toThrow(/getActiveAddresses/);
    });
});
