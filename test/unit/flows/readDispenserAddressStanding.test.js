// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import { readDispenserAddressStanding } from '../../../packages/core/src/flows/dispenserAddressStanding.js';

const ADDRESS = 'target-address';
const SOURCE = 'source-address';
const VALID_ROW = { address: ADDRESS, source: SOURCE, status: 'valid' };

function messagingWith({
    prefs = { dispenserPreference: '1', onChain: false },
    dispensers = [],
    history = [],
} = {}) {
    return {
        getAddressPreferences: async () => prefs,
        getDispensersForAddress: async () => dispensers,
        getAddressHistory: async () => history,
    };
}

function read(messaging) {
    return readDispenserAddressStanding({
        messaging,
        chainId: 'bitcoin',
        address: ADDRESS,
        source: SOURCE,
    });
}

describe('readDispenserAddressStanding', () => {
    it('reports unseen when all three reads answer without an on-chain trace', async () => {
        await expect(read(messagingWith())).resolves.toMatchObject({ seen: false });
    });

    it('reports seen when address preferences have an on-chain row', async () => {
        const messaging = messagingWith({
            prefs: { dispenserPreference: '1', onChain: true },
        });
        await expect(read(messaging)).resolves.toMatchObject({ seen: true });
    });

    it.each([
        ['a non-empty history array', [{ txid: 'history-1' }]],
        ['a positive history total', { data: [], total: 1 }],
    ])('reports seen for %s', async (_name, history) => {
        await expect(read(messagingWith({ history }))).resolves.toMatchObject({ seen: true });
    });

    it('leaves seen unknown when a messaging method is missing', async () => {
        const messaging = messagingWith();
        delete messaging.getAddressHistory;
        await expect(read(messaging)).resolves.toMatchObject({ seen: null });
    });

    it('leaves seen and origin unknown when a read rejects', async () => {
        const messaging = messagingWith();
        messaging.getDispensersForAddress = async () => { throw new Error('unavailable'); };
        await expect(read(messaging)).resolves.toMatchObject({ seen: null, origin: null });
    });

    it('parses a numeric dispenser preference', async () => {
        const messaging = messagingWith({
            prefs: { dispenserPreference: '2', onChain: false },
        });
        await expect(read(messaging)).resolves.toMatchObject({ preference: 2 });
    });

    it('returns a null preference for a non-numeric value', async () => {
        const messaging = messagingWith({
            prefs: { dispenserPreference: 'not-a-number', onChain: false },
        });
        await expect(read(messaging)).resolves.toMatchObject({ preference: null });
    });

    it.each(['valid', 'VALID', 'VaLiD'])('accepts matching origin status %s', async (status) => {
        const dispensers = [{ ...VALID_ROW, status }];
        await expect(read(messagingWith({ dispensers }))).resolves.toMatchObject({ origin: true });
    });

    it.each([
        ['address', { ...VALID_ROW, address: 'other-address' }],
        ['source', { ...VALID_ROW, source: 'other-source' }],
        ['status', { ...VALID_ROW, status: 'invalid' }],
    ])('rejects an origin row with a non-matching %s', async (_field, row) => {
        await expect(read(messagingWith({ dispensers: [row] })))
            .resolves.toMatchObject({ origin: false });
    });

    it('leaves origin unknown when the dispenser read is unavailable', async () => {
        const messaging = messagingWith();
        delete messaging.getDispensersForAddress;
        await expect(read(messaging)).resolves.toMatchObject({ origin: null });
    });

    it.each([
        ['bare array', [VALID_ROW]],
        ['data envelope', { data: [VALID_ROW] }],
        ['rows envelope', { rows: [VALID_ROW] }],
    ])('accepts dispenser rows as a %s', async (_name, dispensers) => {
        await expect(read(messagingWith({ dispensers })))
            .resolves.toMatchObject({ origin: true, seen: true });
    });
});
