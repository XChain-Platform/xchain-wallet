// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    PICKS,
    QR_MAX_CHARS,
    createPickMemory,
    qrOffered,
} from '../../../packages/connect/src/chooserPick.js';

function createStorage() {
    const values = new Map();
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, value);
        },
        removeItem(key) {
            values.delete(key);
        },
    };
}

describe('chooser pick rules', () => {
    it('offers QR only for positive integer lengths up to the limit', () => {
        expect(QR_MAX_CHARS).toBe(2900);
        expect(qrOffered(2899)).toBe(true);
        expect(qrOffered(2900)).toBe(true);
        expect(qrOffered(2901)).toBe(false);
        expect(qrOffered(0)).toBe(false);
        expect(qrOffered(-1)).toBe(false);
        expect(qrOffered(1.5)).toBe(false);
    });

    it('publishes the frozen chooser picks', () => {
        expect(PICKS).toEqual(['app', 'web', 'get']);
        expect(Object.isFrozen(PICKS)).toBe(true);
    });

    it('round trips a remembered pick', () => {
        const memory = createPickMemory(createStorage(), 'site');

        expect(memory.get()).toBeNull();
        memory.set('web');
        expect(memory.get()).toBe('web');
    });

    it('keeps picks separate by origin', () => {
        const storage = createStorage();
        const first = createPickMemory(storage, 'first-site');
        const second = createPickMemory(storage, 'second-site');

        first.set('app');
        second.set('get');

        expect(first.get()).toBe('app');
        expect(second.get()).toBe('get');
    });

    it('returns null for a tampered stored value', () => {
        const storage = createStorage();
        const memory = createPickMemory(storage, 'site');
        storage.setItem('xchain-connect-pick:site', 'other');

        expect(memory.get()).toBeNull();
    });

    it('refuses a pick outside the published choices', () => {
        const memory = createPickMemory(createStorage(), 'site');

        expect(() => memory.set('other')).toThrow(TypeError);
    });
});
