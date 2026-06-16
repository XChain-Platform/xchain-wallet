// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/watchlistEntry — createWatchlistEntry + validateWatchlistEntry + watchlistEntryKey.

import { describe, it, expect } from 'vitest';
import {
    createWatchlistEntry,
    validateWatchlistEntry,
    watchlistEntryKey,
    CURRENT_VERSION,
} from '../../../packages/core/src/schemas/watchlistEntry.js';

const BASE_INPUT = {
    walletId: 'wallet-1',
    chainId: 'bitcoin-mainnet',
    tick1: 'MYTOKEN',
    tick2: 'BTC',
};

describe('createWatchlistEntry', () => {
    it('creates a well-formed entry', () => {
        const e = createWatchlistEntry(BASE_INPUT);
        expect(e.schemaVersion).toBe(CURRENT_VERSION);
        expect(typeof e.id).toBe('string');
        expect(e.walletId).toBe('wallet-1');
        expect(e.chainId).toBe('bitcoin-mainnet');
        expect(e.tick1).toBe('MYTOKEN');
        expect(e.tick2).toBe('BTC');
        expect(typeof e.createdAt).toBe('string');
        expect(Number.isFinite(Date.parse(e.createdAt))).toBe(true);
    });

    it('generates unique ids', () => {
        const e1 = createWatchlistEntry(BASE_INPUT);
        const e2 = createWatchlistEntry(BASE_INPUT);
        expect(e1.id).not.toBe(e2.id);
    });

    it('passes validation immediately after creation', () => {
        const r = validateWatchlistEntry(createWatchlistEntry(BASE_INPUT));
        expect(r.ok).toBe(true);
    });
});

describe('validateWatchlistEntry', () => {
    it('accepts a valid record', () => {
        const r = validateWatchlistEntry(createWatchlistEntry(BASE_INPUT));
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
        expect(validateWatchlistEntry(null).ok).toBe(false);
        expect(validateWatchlistEntry('x').ok).toBe(false);
        expect(validateWatchlistEntry(42).ok).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
        const e = createWatchlistEntry(BASE_INPUT);
        const r = validateWatchlistEntry({ ...e, schemaVersion: 99 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((err) => err.includes('schemaVersion'))).toBe(true);
    });

    it('rejects empty id', () => {
        const e = createWatchlistEntry(BASE_INPUT);
        expect(validateWatchlistEntry({ ...e, id: '' }).ok).toBe(false);
    });

    it('rejects empty walletId', () => {
        const e = createWatchlistEntry(BASE_INPUT);
        const r = validateWatchlistEntry({ ...e, walletId: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((err) => err.includes('walletId'))).toBe(true);
    });

    it('rejects empty chainId', () => {
        const e = createWatchlistEntry(BASE_INPUT);
        expect(validateWatchlistEntry({ ...e, chainId: '' }).ok).toBe(false);
    });

    it('rejects empty tick1', () => {
        const e = createWatchlistEntry(BASE_INPUT);
        const r = validateWatchlistEntry({ ...e, tick1: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((err) => err.includes('tick1'))).toBe(true);
    });

    it('rejects empty tick2', () => {
        const e = createWatchlistEntry(BASE_INPUT);
        const r = validateWatchlistEntry({ ...e, tick2: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((err) => err.includes('tick2'))).toBe(true);
    });

    it('rejects invalid createdAt', () => {
        const e = createWatchlistEntry(BASE_INPUT);
        expect(validateWatchlistEntry({ ...e, createdAt: 'bad' }).ok).toBe(false);
    });

    it('rejects non-string walletId', () => {
        const e = createWatchlistEntry(BASE_INPUT);
        expect(validateWatchlistEntry({ ...e, walletId: 42 }).ok).toBe(false);
    });
});

describe('watchlistEntryKey', () => {
    it('builds the canonical key', () => {
        const e = createWatchlistEntry(BASE_INPUT);
        expect(watchlistEntryKey(e)).toBe('bitcoin-mainnet::MYTOKEN::BTC');
    });

    it('is consistent for the same values', () => {
        const k1 = watchlistEntryKey({ chainId: 'X', tick1: 'A', tick2: 'B' });
        const k2 = watchlistEntryKey({ chainId: 'X', tick1: 'A', tick2: 'B' });
        expect(k1).toBe(k2);
    });

    it('differs for different tick combinations', () => {
        const k1 = watchlistEntryKey({ chainId: 'X', tick1: 'A', tick2: 'B' });
        const k2 = watchlistEntryKey({ chainId: 'X', tick1: 'B', tick2: 'A' });
        expect(k1).not.toBe(k2);
    });
});
