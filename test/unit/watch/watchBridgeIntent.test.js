// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createWatchBridge } from '../../../packages/core/src/watch/watchBridge.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function settle() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('createWatchBridge onIntent', () => {
    it('leaves an inert subscription when the plugin is absent', () => {
        const getPlugin = vi.fn(() => null);
        const handler = vi.fn();
        const unsubscribe = createWatchBridge({ getPlugin }).onIntent(handler);

        expect(getPlugin).toHaveBeenCalledWith('XChainWatch', { method: 'addListener' });
        expect(() => unsubscribe()).not.toThrow();
        expect(handler).not.toHaveBeenCalled();
    });

    it('passes the native event object to the handler unchanged', async () => {
        const event = { kind: 'refresh' };
        const handler = vi.fn();
        const addListener = vi.fn().mockResolvedValue({ remove: vi.fn() });
        createWatchBridge({ getPlugin: () => ({ addListener }) }).onIntent(handler);
        const listener = addListener.mock.calls[0][1];

        listener(event);
        await settle();

        expect(addListener).toHaveBeenCalledWith('intent', listener);
        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith(event);
        expect(handler.mock.calls[0][0]).toBe(event);
    });

    it('swallows a throw from the handler', () => {
        const handler = vi.fn(() => { throw new Error('handler failed'); });
        const addListener = vi.fn().mockResolvedValue({ remove: vi.fn() });
        createWatchBridge({ getPlugin: () => ({ addListener }) }).onIntent(handler);
        const listener = addListener.mock.calls[0][1];

        expect(() => listener({ kind: 'refresh' })).not.toThrow();
        expect(handler).toHaveBeenCalledOnce();
    });

    it('swallows a rejection from the handler', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('handler failed'));
        const addListener = vi.fn().mockResolvedValue({ remove: vi.fn() });
        createWatchBridge({ getPlugin: () => ({ addListener }) }).onIntent(handler);
        const listener = addListener.mock.calls[0][1];

        expect(() => listener({ kind: 'refresh' })).not.toThrow();
        await settle();
        expect(handler).toHaveBeenCalledOnce();
    });

    it('removes the listener once when unsubscribed after the handle resolves', async () => {
        const remove = vi.fn();
        const addListener = vi.fn().mockResolvedValue({ remove });
        const unsubscribe = createWatchBridge({
            getPlugin: () => ({ addListener }),
        }).onIntent(vi.fn());
        await settle();

        expect(() => unsubscribe()).not.toThrow();
        expect(remove).toHaveBeenCalledOnce();
    });

    it('removes the listener on arrival when unsubscribed before the handle resolves', async () => {
        const pending = deferred();
        const remove = vi.fn();
        const addListener = vi.fn(() => pending.promise);
        const unsubscribe = createWatchBridge({
            getPlugin: () => ({ addListener }),
        }).onIntent(vi.fn());

        expect(() => unsubscribe()).not.toThrow();
        expect(remove).not.toHaveBeenCalled();
        pending.resolve({ remove });
        await settle();

        expect(remove).toHaveBeenCalledOnce();
    });

    it('does not remove the listener twice on double unsubscribe', async () => {
        const remove = vi.fn();
        const addListener = vi.fn().mockResolvedValue({ remove });
        const unsubscribe = createWatchBridge({
            getPlugin: () => ({ addListener }),
        }).onIntent(vi.fn());
        await settle();

        unsubscribe();
        unsubscribe();

        expect(remove).toHaveBeenCalledOnce();
    });

    it('never throws when remove throws or rejects', async () => {
        const throwingRemove = vi.fn(() => { throw new Error('remove failed'); });
        const rejectingRemove = vi.fn().mockRejectedValue(new Error('remove failed'));
        const throwingUnsubscribe = createWatchBridge({
            getPlugin: () => ({ addListener: () => ({ remove: throwingRemove }) }),
        }).onIntent(vi.fn());
        const rejectingUnsubscribe = createWatchBridge({
            getPlugin: () => ({ addListener: () => ({ remove: rejectingRemove }) }),
        }).onIntent(vi.fn());
        await settle();

        expect(() => throwingUnsubscribe()).not.toThrow();
        expect(() => rejectingUnsubscribe()).not.toThrow();
        await settle();
        expect(throwingRemove).toHaveBeenCalledOnce();
        expect(rejectingRemove).toHaveBeenCalledOnce();
    });

    it('leaves an inert subscription when addListener throws', () => {
        const addListener = vi.fn(() => { throw new Error('listener failed'); });
        const unsubscribe = createWatchBridge({
            getPlugin: () => ({ addListener }),
        }).onIntent(vi.fn());

        expect(() => unsubscribe()).not.toThrow();
        expect(addListener).toHaveBeenCalledOnce();
    });

    it('leaves an inert subscription when addListener rejects', async () => {
        const addListener = vi.fn().mockRejectedValue(new Error('listener failed'));
        const unsubscribe = createWatchBridge({
            getPlugin: () => ({ addListener }),
        }).onIntent(vi.fn());
        await settle();

        expect(() => unsubscribe()).not.toThrow();
        expect(addListener).toHaveBeenCalledOnce();
    });

    it('rejects a non-function handler', () => {
        const getPlugin = vi.fn();
        const bridge = createWatchBridge({ getPlugin });

        expect(() => bridge.onIntent(null)).toThrow(TypeError);
        expect(getPlugin).not.toHaveBeenCalled();
    });
});
