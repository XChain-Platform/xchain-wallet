// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { routeWatchIntent } from '../../../packages/core/src/watch/watchIntents.js';

const kinds = ['refresh', 'detailRequest', 'openOnPhone', 'markRead', 'watchState'];

describe('routeWatchIntent', () => {
    it.each(kinds)('routes the %s intent and awaits its handler', async (kind) => {
        const value = { id: kind };
        const validate = vi.fn(() => true);
        let finish;
        const handler = vi.fn(() => new Promise((resolve) => {
            finish = resolve;
        }));

        const routed = routeWatchIntent(kind, value, { [kind]: handler }, { validate });
        await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(value));
        let settled = false;
        routed.then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);

        finish();
        await expect(routed).resolves.toBe(true);
        expect(validate).toHaveBeenCalledWith(kind, value);
    });

    it.each([
        ['unknown kind', 'unknown', { id: 1 }],
        ['string value', 'refresh', 'value'],
        ['null value', 'refresh', null],
        ['array value', 'refresh', []],
    ])('rejects an %s without validation or dispatch', async (_label, kind, value) => {
        const handler = vi.fn();
        const validate = vi.fn(() => true);

        await expect(routeWatchIntent(kind, value, { refresh: handler }, { validate })).resolves.toBe(false);
        expect(validate).not.toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
    });

    it('rejects missing, non-function and inherited handlers', async () => {
        const inherited = vi.fn();
        const handlers = Object.create({ refresh: inherited });
        const getterFailure = {};
        Object.defineProperty(getterFailure, 'refresh', {
            get: () => { throw new Error('getter'); },
        });

        await expect(routeWatchIntent('refresh', {}, handlers)).resolves.toBe(false);
        await expect(routeWatchIntent('refresh', {}, { refresh: true })).resolves.toBe(false);
        await expect(routeWatchIntent('refresh', {}, {})).resolves.toBe(false);
        await expect(routeWatchIntent('refresh', {}, null)).resolves.toBe(false);
        await expect(routeWatchIntent('refresh', {}, getterFailure)).resolves.toBe(false);
        expect(inherited).not.toHaveBeenCalled();
    });

    it.each(['toString', '__proto__'])('does not dispatch the inherited %s key', async (kind) => {
        const handler = vi.fn();

        await expect(routeWatchIntent(kind, {}, { [kind]: handler })).resolves.toBe(false);
        expect(handler).not.toHaveBeenCalled();
    });

    it('does not dispatch when validation fails', async () => {
        const handler = vi.fn();
        const validate = vi.fn(() => false);
        const value = { id: 1 };

        await expect(routeWatchIntent('detailRequest', value, { detailRequest: handler }, { validate }))
            .resolves.toBe(false);
        expect(validate).toHaveBeenCalledWith('detailRequest', value);
        expect(handler).not.toHaveBeenCalled();
    });

    it('resolves false when validation or the handler throws or rejects', async () => {
        const syncFailure = vi.fn(() => { throw new Error('sync'); });
        const asyncFailure = vi.fn().mockRejectedValue(new Error('async'));

        await expect(routeWatchIntent('markRead', {}, { markRead: vi.fn() }, {
            validate: () => { throw new Error('validation'); },
        })).resolves.toBe(false);
        await expect(routeWatchIntent('markRead', {}, { markRead: syncFailure })).resolves.toBe(false);
        await expect(routeWatchIntent('watchState', {}, { watchState: asyncFailure })).resolves.toBe(false);
        expect(syncFailure).toHaveBeenCalledOnce();
        expect(asyncFailure).toHaveBeenCalledOnce();
    });
});
