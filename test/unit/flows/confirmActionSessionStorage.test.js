// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MV3 confirm-modal session persistence (§5.4).

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    createConfirmActionSessionStorage, reservationStoreFrom,
} from '../../../packages/extension/src/background/confirmActionSessionStorage.js';
import { createReservationLedger } from '../../../packages/core/src/flows/reservationLedger.js';

afterEach(() => { delete globalThis.chrome; });

// Minimal chrome.storage.session mock backed by a plain object.
function mockChromeSession() {
    const store = {};
    globalThis.chrome = {
        storage: {
            session: {
                get: (key, cb) => cb({ [key]: store[key] }),
                set: (obj, cb) => { Object.assign(store, obj); cb(); },
            },
        },
    };
    return store;
}

describe('confirmActionSessionStorage', () => {

    it('returns null when chrome.storage.session is unavailable', () => {
        expect(createConfirmActionSessionStorage()).toBe(null);
    });

    it('persists and rehydrates a self-contained confirm session', async () => {
        mockChromeSession();
        const storage = createConfirmActionSessionStorage();
        const session = { id: 'req1', request: { chainId: 'btc' }, composed: { psbt: 'HEX' }, report: { verdict: 'pass' } };
        await storage.putSession('req1', session);

        // Simulate an SW restart: a fresh storage handle reads the same data.
        const restarted = createConfirmActionSessionStorage();
        const all = await restarted.loadSessions();
        expect(all.req1.composed.psbt).toBe('HEX');   // PSBT hex survives, no re-compose needed
        expect(all.req1.report.verdict).toBe('pass');

        await storage.removeSession('req1');
        expect((await storage.loadSessions()).req1).toBeUndefined();
    });

    it('keeps a removed session removed when another page persists at the same time', async () => {
        const store = { 'xchain.confirmAction': { spent: { id: 'spent' } } };
        globalThis.chrome = {
            storage: {
                session: {
                    get: (key, cb) => queueMicrotask(() => cb({
                        [key]: store[key] === undefined
                            ? undefined
                            : JSON.parse(JSON.stringify(store[key])),
                    })),
                    set: (obj, cb) => queueMicrotask(() => {
                        Object.assign(store, JSON.parse(JSON.stringify(obj)));
                        cb();
                    }),
                },
            },
        };
        const storage = createConfirmActionSessionStorage();

        await Promise.all([
            storage.removeSession('spent'),
            storage.putSession('fresh', { id: 'fresh' }),
        ]);

        expect(Object.keys(await storage.loadSessions())).toEqual(['fresh']);
    });

    it('keeps both sessions when two confirm pages persist concurrently', async () => {
        const store = {};
        globalThis.chrome = {
            storage: {
                session: {
                    get: (key, cb) => queueMicrotask(() => cb({
                        [key]: store[key] === undefined
                            ? undefined
                            : JSON.parse(JSON.stringify(store[key])),
                    })),
                    set: (obj, cb) => queueMicrotask(() => {
                        Object.assign(store, JSON.parse(JSON.stringify(obj)));
                        cb();
                    }),
                },
            },
        };
        const storage = createConfirmActionSessionStorage();

        await Promise.all([
            storage.putSession('first', { id: 'first' }),
            storage.putSession('second', { id: 'second' }),
        ]);

        expect(Object.keys(await storage.loadSessions()).sort()).toEqual(['first', 'second']);
    });

    it('backs the reservation ledger so reservations survive an SW kill', async () => {
        mockChromeSession();
        const storage = createConfirmActionSessionStorage();
        const store = reservationStoreFrom(storage);

        // Ledger A reserves, then is "killed" (dropped).
        const ledgerA = createReservationLedger({ store });
        await ledgerA.reserve({ id: 'r1', chainId: 'btc', tick: 'JDOG', amount: '10' });

        // Ledger B rehydrates from session storage after the SW restart.
        const ledgerB = createReservationLedger({ store });
        const survived = await ledgerB.all();
        expect(survived.find((r) => r.id === 'r1')).toBeTruthy();
    });
});
