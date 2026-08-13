// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: . The store-listing capture has to be REPRODUCIBLE, or
// verify-listing-assets.mjs's own way out ("re-capture, it re-pins as it
// goes") can never distinguish a product change from a dice roll.
//
// Covers the two frozen inputs and the fixture clock they act through:
//   - capture mode is OFF unless the harness armed it, so an ordinary
//     demo user still gets a freshly generated throwaway wallet;
//   - the frozen mnemonic is a real, valid BIP39 phrase (an invalid one
//     would break the demo lane at the point nobody runs by hand) and is
//     the published all-zero test vector, not something a reader could
//     mistake for an operator's seed;
//   - every demo fixture that dates a row takes `opts.now`, and the same
//     `now` produces the same rows while a different one moves them.
//     Two functions did not take it, and that is what moved the pixels.

import { describe, it, expect, afterEach } from 'vitest';
import {
    DEMO_CAPTURE_FLAG_KEY,
    DEMO_CAPTURE_MNEMONIC,
    DEMO_CAPTURE_CLOCK_MS,
    DEMO_CHART_SEED,
    isDemoCaptureMode,
    demoCaptureMnemonic,
} from '../../../packages/core/src/flows/demoCapture.js';
import { isValidBip39Mnemonic } from '../../../packages/core/src/crypto/mnemonic.js';
import {
    synthesizeDemoDefiPositions,
    synthesizeDemoDispenses,
    synthesizeDemoHistory,
    synthesizeDemoMarketActivity,
    synthesizeDemoMessages,
    synthesizeDemoNativePrices,
} from '../../../packages/core/src/flows/demoFixtures.js';

function arm() {
    globalThis.localStorage.setItem(DEMO_CAPTURE_FLAG_KEY, '1');
}

afterEach(() => {
    globalThis.localStorage.removeItem(DEMO_CAPTURE_FLAG_KEY);
});

describe('demo capture mode', () => {
    it('is off unless the capture harness armed it', () => {
        expect(isDemoCaptureMode()).toBe(false);
        expect(demoCaptureMnemonic()).toBe(null);
    });

    it('hands the frozen mnemonic to the demo lane once armed', () => {
        arm();
        expect(isDemoCaptureMode()).toBe(true);
        expect(demoCaptureMnemonic()).toBe(DEMO_CAPTURE_MNEMONIC);
    });

    it('only answers to the exact armed value', () => {
        globalThis.localStorage.setItem(DEMO_CAPTURE_FLAG_KEY, 'true');
        expect(isDemoCaptureMode()).toBe(false);
        expect(demoCaptureMnemonic()).toBe(null);
    });

    it('treats an unavailable localStorage as not capturing', () => {
        const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            get() { throw new Error('storage is blocked in this shell'); },
        });
        try {
            expect(isDemoCaptureMode()).toBe(false);
            expect(demoCaptureMnemonic()).toBe(null);
        } finally {
            if (real) Object.defineProperty(globalThis, 'localStorage', real);
        }
    });

    it('freezes a mnemonic the wallet can actually import', () => {
        expect(isValidBip39Mnemonic(DEMO_CAPTURE_MNEMONIC)).toBe(true);
        expect(DEMO_CAPTURE_MNEMONIC.split(' ')).toHaveLength(12);
    });

    it('freezes the published BIP39 test vector, so no reader can take it for a real seed', () => {
        // All-zero entropy. Every address it derives is swept within
        // seconds, which is exactly why it is safe to publish and unsafe
        // to fund; a phrase that looked "random enough" would read as a
        // leaked seed to anyone scanning this tree later.
        expect(DEMO_CAPTURE_MNEMONIC).toBe(
            `${'abandon '.repeat(11)}about`,
        );
    });

    it('freezes one fixed instant, not a value that moves per run', () => {
        expect(Number.isInteger(DEMO_CAPTURE_CLOCK_MS)).toBe(true);
        expect(new Date(DEMO_CAPTURE_CLOCK_MS).toISOString()).toBe('2026-01-15T15:04:00.000Z');
    });

    it('gives demo wallets a chart seed that is not their per-session id', () => {
        expect(typeof DEMO_CHART_SEED).toBe('string');
        expect(DEMO_CHART_SEED.length).toBeGreaterThan(0);
    });
});

describe('demo fixtures are clock-injectable', () => {
    const NOW = DEMO_CAPTURE_CLOCK_MS;
    const LATER = NOW + 6 * 60 * 60 * 1000;

    // The two that had no `opts.now` at all: their rows moved on every
    // run, which is half of why a re-capture never reproduced.
    it('synthesizeDemoDefiPositions repeats exactly at one instant', () => {
        expect(synthesizeDemoDefiPositions({ now: NOW }))
            .toEqual(synthesizeDemoDefiPositions({ now: NOW }));
    });

    it('synthesizeDemoDefiPositions really reads the injected clock', () => {
        const early = synthesizeDemoDefiPositions({ now: NOW });
        const late = synthesizeDemoDefiPositions({ now: LATER });
        expect(late.length).toBe(early.length);
        expect(late.map((r) => r.timestamp)).not.toEqual(early.map((r) => r.timestamp));
        expect(late[0].timestamp - early[0].timestamp).toBe((LATER - NOW) / 1000);
    });

    it('synthesizeDemoDispenses repeats exactly at one instant', () => {
        // A dispenser with fills; an actionIndex with none returns [] and
        // would pass this test without exercising the clock at all.
        const rows = synthesizeDemoDispenses('4200981', { now: NOW });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows).toEqual(synthesizeDemoDispenses('4200981', { now: NOW }));
    });

    it('synthesizeDemoDispenses really reads the injected clock', () => {
        const early = synthesizeDemoDispenses('4200981', { now: NOW });
        const late = synthesizeDemoDispenses('4200981', { now: LATER });
        expect(late[0].timestamp - early[0].timestamp).toBe((LATER - NOW) / 1000);
    });

    // The demo wallet's own prices. Before this existed the hero's 24h
    // change came from the LIVE oracle while every other number on the
    // screen was synthetic, so whether the fetch landed before the
    // screenshot decided whether the line rendered at all - and the whole
    // card below it moved by a line's height when it did.
    it('prices a demo wallet from its own fixtures', () => {
        const ids = ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'];
        const prices = synthesizeDemoNativePrices(ids);
        expect(prices).toEqual(synthesizeDemoNativePrices(ids));
        for (const id of ids) {
            expect(Number.isFinite(prices[id].change24hPct)).toBe(true);
            expect(prices[id].priceFiat).toBeGreaterThan(0);
            // The chart already owns a stable walk; a fabricated series
            // here would be a second source for the same line.
            expect(prices[id].sparkline).toBe(null);
        }
    });

    it('leaves a chain the demo does not price unpriced', () => {
        // Testnet coins have no fiat rate in the fixtures, and inventing
        // one would put a dollar figure on a coin that has none.
        expect(synthesizeDemoNativePrices(['bitcoin-testnet'])['bitcoin-testnet']).toBe(null);
        expect(synthesizeDemoNativePrices(['not-a-chain'])['not-a-chain']).toBe(null);
        expect(synthesizeDemoNativePrices(null)).toEqual({});
    });

    // The three that already took it, kept honest so the family stays
    // uniform: freezing two of five would still leave a moving image.
    it('the fixtures that already took opts.now still honour it', () => {
        const addr = 'bc1qdemoaddressforfixtureclockinjection00000';
        expect(synthesizeDemoHistory('bitcoin-mainnet', addr, { now: NOW }))
            .toEqual(synthesizeDemoHistory('bitcoin-mainnet', addr, { now: NOW }));
        expect(synthesizeDemoHistory('bitcoin-mainnet', addr, { now: LATER }))
            .not.toEqual(synthesizeDemoHistory('bitcoin-mainnet', addr, { now: NOW }));

        expect(synthesizeDemoMarketActivity('EXAMPLE', { now: NOW }))
            .toEqual(synthesizeDemoMarketActivity('EXAMPLE', { now: NOW }));

        expect(synthesizeDemoMessages(addr, { now: NOW }))
            .toEqual(synthesizeDemoMessages(addr, { now: NOW }));
    });
});
