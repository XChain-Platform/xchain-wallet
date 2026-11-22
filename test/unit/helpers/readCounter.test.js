// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { countCalls } from '../../helpers/readCounter.js';

class CounterTarget {
    constructor(prefix) {
        this.prefix = prefix;
        this.value = 7;
    }

    inherited(suffix) {
        return `${this.prefix}:${suffix}`;
    }
}

describe('read counter', () => {
    it('counts sync, async, and inherited methods separately', async () => {
        const target = new CounterTarget('bound');
        target.sync = (value) => value * 2;
        target.async = async (value) => value + 1;
        const counter = countCalls(target);

        expect(counter.api.sync(3)).toBe(6);
        await expect(counter.api.async(4)).resolves.toBe(5);
        expect(counter.api.inherited('method')).toBe('bound:method');
        expect(counter.counts).toMatchObject({ sync: 1, async: 1, inherited: 1 });
        expect(counter.total()).toBe(3);
    });

    it('binds method this to the target and passes plain values through', () => {
        const target = {
            value: 7,
            readValue(increment) {
                return this.value + increment;
            },
        };
        const counter = countCalls(target);

        const detached = counter.api.readValue;
        expect(detached(2)).toBe(9);
        expect(counter.api.value).toBe(7);
        expect(counter.counts).toMatchObject({ readValue: 1 });
        expect(counter.counts.value).toBeUndefined();
        expect(counter.total()).toBe(1);
    });

    it('counts rejecting methods and reset zeroes every count', async () => {
        const failure = new Error('expected rejection');
        const counter = countCalls({
            reject() {
                return Promise.reject(failure);
            },
            succeed() {
                return true;
            },
        });

        await expect(counter.api.reject()).rejects.toBe(failure);
        expect(counter.api.succeed()).toBe(true);
        expect(counter.counts).toMatchObject({ reject: 1, succeed: 1 });
        expect(counter.total()).toBe(2);

        counter.reset();
        expect(counter.counts).toMatchObject({ reject: 0, succeed: 0 });
        expect(counter.total()).toBe(0);
    });
});
