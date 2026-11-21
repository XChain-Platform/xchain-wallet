// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createSingleFlight } from '../../../packages/core/src/watch/watchSingleFlight.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, reject, resolve };
}

describe('createSingleFlight', () => {
    it('shares one run and one value between concurrent gets for a key', async () => {
        const pending = deferred();
        const run = vi.fn(() => pending.promise);
        const singleFlight = createSingleFlight(run);

        const first = singleFlight.get('token-1');
        const second = singleFlight.get('token-1');

        expect(first).toBe(second);
        expect(run).toHaveBeenCalledOnce();
        expect(run).toHaveBeenCalledWith('token-1');

        pending.resolve({ symbol: 'TOK' });
        await expect(Promise.all([first, second])).resolves.toEqual([
            { symbol: 'TOK' },
            { symbol: 'TOK' },
        ]);
    });

    it('runs independent flights for different keys', async () => {
        const run = vi.fn(async (key) => `value:${key}`);
        const singleFlight = createSingleFlight(run);

        await expect(Promise.all([
            singleFlight.get('token-1'),
            singleFlight.get('token-2'),
        ])).resolves.toEqual(['value:token-1', 'value:token-2']);
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('runs again after a flight settles', async () => {
        const run = vi.fn(async () => run.mock.calls.length);
        const singleFlight = createSingleFlight(run);

        await expect(singleFlight.get('token-1')).resolves.toBe(1);
        expect(singleFlight.pending()).toBe(0);
        await expect(singleFlight.get('token-1')).resolves.toBe(2);
        expect(run).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['a rejected run', () => Promise.reject(new Error('read rejected'))],
        ['a throwing run', () => { throw new Error('read threw'); }],
    ])('shares %s with every waiter and clears the flight', async (_name, implementation) => {
        const run = vi.fn(implementation);
        const singleFlight = createSingleFlight(run);

        const first = singleFlight.get('token-1');
        const second = singleFlight.get('token-1');

        expect(first).toBe(second);
        await expect(first).rejects.toThrow(/^read (rejected|threw)$/);
        await expect(second).rejects.toThrow(/^read (rejected|threw)$/);
        expect(singleFlight.pending()).toBe(0);

        await expect(singleFlight.get('token-1')).rejects.toThrow(/^read (rejected|threw)$/);
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('reports the number of pending keys', async () => {
        const first = deferred();
        const second = deferred();
        const singleFlight = createSingleFlight((key) => (
            key === 'token-1' ? first.promise : second.promise
        ));

        expect(singleFlight.pending()).toBe(0);
        singleFlight.get('token-1');
        singleFlight.get('token-1');
        singleFlight.get('token-2');
        expect(singleFlight.pending()).toBe(2);

        first.resolve('first');
        await first.promise;
        await Promise.resolve();
        expect(singleFlight.pending()).toBe(1);

        second.resolve('second');
        await second.promise;
        await Promise.resolve();
        expect(singleFlight.pending()).toBe(0);
    });

    it.each(['', undefined, null, 0, {}, []])(
        'throws a TypeError for the invalid key %j',
        (key) => {
            const run = vi.fn();
            const singleFlight = createSingleFlight(run);

            expect(() => singleFlight.get(key)).toThrow(TypeError);
            expect(run).not.toHaveBeenCalled();
            expect(singleFlight.pending()).toBe(0);
        },
    );
});
