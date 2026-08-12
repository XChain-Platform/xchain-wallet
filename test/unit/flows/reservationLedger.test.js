// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// In-flight approval reservation ledger ( §4.7).

import { describe, it, expect, vi } from 'vitest';
import { createReservationLedger } from '../../../packages/core/src/flows/reservationLedger.js';

describe('reservationLedger (in-memory)', () => {

    it('reserve/release round-trip', async () => {
        const led = createReservationLedger();
        await led.reserve({ id: 'a', chainId: 'btc', tick: 'JDOG', amount: '5' });
        expect(await led.all()).toHaveLength(1);
        await led.release('a');
        expect(await led.all()).toHaveLength(0);
    });

    it('localDeltas nets per-tick and excludes the caller own reservation', async () => {
        const led = createReservationLedger();
        await led.reserve({ id: 'a', chainId: 'btc', tick: 'JDOG', amount: '5' });
        await led.reserve({ id: 'b', chainId: 'btc', tick: 'JDOG', amount: '3' });
        await led.reserve({ id: 'c', chainId: 'btc', tick: 'GAS', amount: '2' });
        await led.reserve({ id: 'd', chainId: 'ltc', tick: 'JDOG', amount: '9' });

        // From window 'a', the OTHER btc reservations are b (JDOG 3) + c (GAS 2).
        const deltas = await led.localDeltas('btc', 'a');
        const jdog = deltas.find((d) => d.tick === 'JDOG');
        const gas = deltas.find((d) => d.tick === 'GAS');
        expect(jdog.amount).toBe('3');
        expect(gas.amount).toBe('2');
        // ltc is a different chain; excluded.
        expect(deltas.some((d) => d.tick === 'JDOG' && d.amount === '9')).toBe(false);
    });

    it('reserve is idempotent on id (survives a rehydrate double-register)', async () => {
        const led = createReservationLedger();
        await led.reserve({ id: 'a', chainId: 'btc', tick: 'JDOG', amount: '5' });
        await led.reserve({ id: 'a', chainId: 'btc', tick: 'JDOG', amount: '5' });
        expect(await led.all()).toHaveLength(1);
    });

    it('the two-window same-balance race: window 2 sees window 1s reservation', async () => {
        const led = createReservationLedger();
        // Window 1 approves a spend of the whole balance.
        await led.reserve({ id: 'w1', chainId: 'btc', tick: 'JDOG', amount: '100' });
        // Window 2, checking its own preflight, nets w1's reservation.
        const deltas = await led.localDeltas('btc', 'w2');
        expect(deltas).toEqual([{ tick: 'JDOG', amount: '100' }]);
    });

    // Exact decimal netting (). Float accumulation understated the delta the
    // concurrent-spend guard subtracts, which is a silently weakened guard.
    it('nets fractional reservations exactly (no float residue)', async () => {
        const led = createReservationLedger();
        await led.reserve({ id: 'a', chainId: 'btc', tick: 'JDOG', amount: '0.1' });
        await led.reserve({ id: 'b', chainId: 'btc', tick: 'JDOG', amount: '0.2' });
        expect(await led.localDeltas('btc')).toEqual([{ tick: 'JDOG', amount: '0.3' }]);
    });

    it('nets integer reservations past 2^53 without rounding', async () => {
        const led = createReservationLedger();
        await led.reserve({ id: 'a', chainId: 'btc', tick: 'JDOG', amount: '9007199254740993' });
        await led.reserve({ id: 'b', chainId: 'btc', tick: 'JDOG', amount: '1' });
        expect(await led.localDeltas('btc')).toEqual([{ tick: 'JDOG', amount: '9007199254740994' }]);
    });

    it('keeps an 18-decimal dust reservation in the total', async () => {
        const led = createReservationLedger();
        await led.reserve({ id: 'a', chainId: 'btc', tick: 'JDOG', amount: '1' });
        await led.reserve({ id: 'b', chainId: 'btc', tick: 'JDOG', amount: '0.000000000000000001' });
        expect(await led.localDeltas('btc')).toEqual([
            { tick: 'JDOG', amount: '1.000000000000000001' },
        ]);
    });

    // A reserve() caller stringifies a JS number, so a small enough amount arrives as
    // "1e-8"; the exact summer skips anything not already plain decimal, and a skipped
    // reservation is one missing from the delta.
    it('counts a scientific-notation amount instead of dropping it', async () => {
        const led = createReservationLedger();
        await led.reserve({ id: 'a', chainId: 'btc', tick: 'JDOG', amount: String(1e-8) });
        await led.reserve({ id: 'b', chainId: 'btc', tick: 'JDOG', amount: '1' });
        expect(await led.localDeltas('btc')).toEqual([{ tick: 'JDOG', amount: '1.00000001' }]);
    });

    // The other half of that rule: an amount no normalizer can read must not be dropped
    // either. Dropping it understates the delta exactly as the float sum did, so the tick
    // stays in the result carrying a total no balance can cover, and the guard blocks.
    it('nets an unreadable reservation at a blocking total rather than dropping it', async () => {
        const led = createReservationLedger();
        await led.reserve({ id: 'a', chainId: 'btc', tick: 'JDOG', amount: '5' });
        await led.reserve({ id: 'b', chainId: 'btc', tick: 'JDOG', amount: Number.NaN });

        const deltas = await led.localDeltas('btc');
        expect(deltas).toHaveLength(1);
        expect(deltas[0].tick).toBe('JDOG');
        // Above the SDK's 1e21 MAX_SUPPLY ceiling, so no balance can survive subtracting it.
        expect(BigInt(deltas[0].amount) > BigInt('1000000000000000000000')).toBe(true);
        // The readable sibling is still counted, so the sentinel adds to the guard rather
        // than replacing what is known.
        expect(deltas[0].amount).toBe('1000000000000000000000000000005');
    });
});

describe('reservationLedger (session-store backed, extension)', () => {

    it('hydrates from and persists to the store', async () => {
        let saved = [{ id: 'x', chainId: 'btc', tick: 'JDOG', amount: '7' }];
        const store = {
            load: vi.fn(async () => saved),
            save: vi.fn(async (entries) => { saved = entries; }),
        };
        const led = createReservationLedger({ store });
        // Loads the pre-existing reservation.
        expect((await led.all()).find((r) => r.id === 'x')).toBeTruthy();
        // A new reservation persists through the store.
        await led.reserve({ id: 'y', chainId: 'btc', tick: 'GAS', amount: '2' });
        expect(store.save).toHaveBeenCalled();
        expect(saved.some((r) => r.id === 'y')).toBe(true);
        // Release persists too.
        await led.release('x');
        expect(saved.some((r) => r.id === 'x')).toBe(false);
    });

    it('tolerates a store that throws on load', async () => {
        const store = { load: async () => { throw new Error('storage boom'); }, save: async () => {} };
        const led = createReservationLedger({ store });
        expect(await led.all()).toEqual([]);
    });
});
