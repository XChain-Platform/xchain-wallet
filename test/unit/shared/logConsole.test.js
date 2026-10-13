// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    __mirrorTestUtils,
    logConsole,
} from '../../../packages/core/src/shared/utils/logConsole.js';

beforeEach(() => {
    logConsole.detachMirror();
    logConsole.detach();
    logConsole.clear();
    logConsole.setCapacity(500);
});

afterEach(() => {
    logConsole.detachMirror();
    logConsole.detach();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('logConsole buffer', () => {
    it('records structured data, bounds entries, and returns defensive snapshots', () => {
        logConsole.setCapacity(2);
        logConsole.record({ level: 'info', source: 'vault', message: 'first', data: { ok: true } });
        logConsole.record({ level: 'warn', source: 'signer:one', message: 'second' });
        logConsole.record({ level: 'error', source: 'bridge:rpc', message: 'third-long' });

        const entries = logConsole.entries();
        expect(entries.map((entry) => entry.message)).toEqual(['second', 'third-long']);
        entries.pop();
        expect(logConsole.entries()).toHaveLength(2);
        expect(logConsole.snapshot({ limit: 1, messageLimit: 5 })[0])
            .toMatchObject({ level: 'error', source: 'bridge:rpc', message: 'third' });
    });

    it('stringifies console arguments and keeps producer calls alive when a listener throws', () => {
        const original = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const circular = {};
        circular.self = circular;
        const unsubscribe = logConsole.subscribe(() => { throw new Error('listener failed'); });

        logConsole.attach();
        logConsole.attach();
        console.warn('hello', 4, null, new Error('boom'), circular);
        logConsole.detach();
        unsubscribe();

        expect(original).toHaveBeenCalledOnce();
        expect(logConsole.entries()[0]).toMatchObject({ level: 'warn', source: 'console' });
        expect(logConsole.entries()[0].message).toContain('hello 4 null');
        expect(logConsole.entries()[0].message).toContain('boom');
        expect(logConsole.entries()[0].message).toContain('[unserializable]');
        expect(logConsole.isAttached()).toBe(false);
    });

    it('restores sanitized entries in time order without duplicates or notifications', () => {
        const listener = vi.fn();
        logConsole.subscribe(listener);
        logConsole.record({ source: 'app', message: 'live' });
        const live = logConsole.entries()[0];
        listener.mockClear();

        logConsole.restore([
            { id: 12, timestamp: 20, level: 'invalid', source: null, message: null },
            { id: 11, timestamp: 10, level: 'info', source: 'vault', message: 'old' },
            { id: 11, timestamp: 30, level: 'warn', source: 'vault', message: 'duplicate' },
            { id: live.id, timestamp: 1, level: 'log', source: 'vault', message: 'live duplicate' },
            null,
        ]);

        expect(logConsole.entries().map((entry) => entry.id)).toEqual([11, 12, live.id]);
        expect(logConsole.entries()[1]).toMatchObject({ level: 'log', source: 'restore', message: '' });
        expect(listener).not.toHaveBeenCalled();
    });

    it('returns a harmless unsubscribe for invalid listeners', () => {
        expect(() => logConsole.subscribe(null)()).not.toThrow();
        expect(() => logConsole.restore(null)).not.toThrow();
        expect(() => logConsole.setCapacity(0)).not.toThrow();
    });
});

describe('logConsole persistence mirror', () => {
    it('filters sensitive console logs, truncates messages, and debounces saves', async () => {
        vi.useFakeTimers();
        const save = vi.fn(async () => {});
        logConsole.attachMirror({ save, debounceMs: 5, limit: 2, messageLimit: 4 });
        logConsole.record({ source: 'console', message: 'secret' });
        logConsole.record({ source: 'vault', message: 'abcdef' });
        logConsole.record({ source: 'signer:usb', message: 'second' });
        logConsole.record({ source: 'bridge:rpc', message: 'third' });

        await vi.advanceTimersByTimeAsync(5);

        expect(save).toHaveBeenCalledOnce();
        expect(save).toHaveBeenCalledWith([
            expect.objectContaining({ source: 'signer:usb', message: 'seco' }),
            expect.objectContaining({ source: 'bridge:rpc', message: 'thir' }),
        ]);
        expect(logConsole.isMirrorAttached()).toBe(true);
    });

    it('replaces and detaches mirrors without allowing stale writes', async () => {
        vi.useFakeTimers();
        const first = vi.fn();
        const second = vi.fn().mockRejectedValue(new Error('storage down'));
        logConsole.attachMirror({ save: first, debounceMs: 20 });
        logConsole.attachMirror({ save: second, debounceMs: 0, sourceAllow: () => true });
        logConsole.record({ source: 'app', message: 'safe' });

        await vi.runAllTimersAsync();
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledOnce();

        logConsole.detachMirror();
        logConsole.record({ source: 'vault', message: 'after detach' });
        await vi.runAllTimersAsync();
        expect(second).toHaveBeenCalledOnce();
        expect(logConsole.isMirrorAttached()).toBe(false);
    });

    it('publishes the conservative default allow-list and mirror defaults', () => {
        const allow = __mirrorTestUtils.defaultSourceAllow;
        expect(['vault', 'encoder', 'signer:ledger', 'bridge:host'].map(allow))
            .toEqual([true, true, true, true]);
        expect(['console', 'app', null].map(allow)).toEqual([false, false, false]);
        expect(__mirrorTestUtils.DEFAULTS).toEqual({
            limit: 200,
            messageLimit: 500,
            debounceMs: 1000,
        });
        expect(() => logConsole.attachMirror()).not.toThrow();
    });
});
