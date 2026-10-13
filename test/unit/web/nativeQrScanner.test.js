// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The iOS shell's native QR scanner, seen from JS: qrScanStart opens it,
// qrFrame events carry each code, qrScanClosed says why it closed by itself,
// and qrScanStop dismisses it. These drive the adapter against a fake plugin
// that follows that contract, including the listener bookkeeping, since a
// listener left behind would keep feeding codes to a screen that is gone.

import { afterEach, describe, it, expect, vi } from 'vitest';

import { __setNativeVaultForTests } from '../../../packages/web/src/storage/nativeVault.js';
import {
    installNativeQrScanner,
    nativeQrScanner,
    startFailureReason,
    startNativeQrScan,
} from '../../../packages/web/src/storage/nativeQrScanner.js';
import {
    getNativeQrScanner,
    setNativeQrScanner,
} from '../../../packages/core/src/ui/nativeQrScanner.js';

/**
 * A plugin double following the native contract. `listeners` holds only the
 * live ones, so an empty map after a scan proves nothing leaked.
 *
 * @param {{ start?: () => Promise<any>, promiseHandles?: boolean }} [opts]
 */
function fakePlugin({ start, promiseHandles = true } = {}) {
    /** @type {Map<string, Set<Function>>} */
    const listeners = new Map();
    const plugin = {
        listeners,
        loadVault: vi.fn(async () => ({ status: 'ABSENT' })),
        qrScanStart: vi.fn(start || (async () => ({ started: true }))),
        qrScanStop: vi.fn(async () => ({})),
        addListener: vi.fn((event, fn) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(fn);
            const handle = { remove: vi.fn(async () => { listeners.get(event)?.delete(fn); }) };
            return promiseHandles ? Promise.resolve(handle) : handle;
        }),
        emit(event, data) {
            for (const fn of [...(listeners.get(event) || [])]) fn(data);
        },
        liveCount() {
            let n = 0;
            for (const set of listeners.values()) n += set.size;
            return n;
        },
    };
    return plugin;
}

/** Let the handle-removal promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A rejection the way Capacitor delivers `call.reject("denied")`. */
const rejection = (message) => () => Promise.reject(new Error(message));

afterEach(() => {
    __setNativeVaultForTests(undefined);
    setNativeQrScanner(null);
});

describe('startNativeQrScan', () => {
    it('listens before it starts, forwards each code, and stops cleanly', async () => {
        const plugin = fakePlugin();
        __setNativeVaultForTests(plugin);
        const values = [];
        const onClosed = vi.fn();

        const stop = await startNativeQrScan((v) => values.push(v), onClosed);

        expect(plugin.addListener.mock.invocationCallOrder[0])
            .toBeLessThan(plugin.qrScanStart.mock.invocationCallOrder[0]);
        expect(plugin.liveCount()).toBe(2);

        plugin.emit('qrFrame', { value: 'xcw:1/3:aa' });
        plugin.emit('qrFrame', { value: 'xcw:2/3:bb' });
        plugin.emit('qrFrame', { value: 'xcw:3/3:cc' });
        expect(values).toEqual(['xcw:1/3:aa', 'xcw:2/3:bb', 'xcw:3/3:cc']);

        stop();
        await settle();
        expect(plugin.qrScanStop).toHaveBeenCalledTimes(1);
        expect(plugin.liveCount()).toBe(0);

        plugin.emit('qrFrame', { value: 'late' });
        expect(values).toHaveLength(3);
        expect(onClosed).not.toHaveBeenCalled();

        stop();
        await settle();
        expect(plugin.qrScanStop).toHaveBeenCalledTimes(1);
    });

    it('ignores frames with no string value', async () => {
        const plugin = fakePlugin();
        __setNativeVaultForTests(plugin);
        const onValue = vi.fn();
        const stop = await startNativeQrScan(onValue, () => {});
        plugin.emit('qrFrame', {});
        plugin.emit('qrFrame', { value: '' });
        plugin.emit('qrFrame', { value: 42 });
        plugin.emit('qrFrame', null);
        expect(onValue).not.toHaveBeenCalled();
        stop();
        await settle();
    });

    it('rejects a second start without disturbing the running scan', async () => {
        const plugin = fakePlugin();
        __setNativeVaultForTests(plugin);
        const firstValue = vi.fn();
        const secondValue = vi.fn();
        const stop = await startNativeQrScan(firstValue, () => {});

        await expect(startNativeQrScan(secondValue, () => {}))
            .rejects.toMatchObject({ reason: 'busy' });
        expect(plugin.qrScanStart).toHaveBeenCalledTimes(1);
        expect(plugin.addListener).toHaveBeenCalledTimes(2);

        plugin.emit('qrFrame', { value: 'first scan' });
        expect(firstValue).toHaveBeenCalledWith('first scan');
        expect(secondValue).not.toHaveBeenCalled();

        stop();
        await settle();
        expect(plugin.qrScanStop).toHaveBeenCalledTimes(1);

        const stopNext = await startNativeQrScan(() => {}, () => {});
        expect(plugin.qrScanStart).toHaveBeenCalledTimes(2);
        stopNext();
        await settle();
    });

    it('also removes listeners whose handles come back synchronously', async () => {
        const plugin = fakePlugin({ promiseHandles: false });
        __setNativeVaultForTests(plugin);
        const stop = await startNativeQrScan(() => {}, () => {});
        expect(plugin.liveCount()).toBe(2);
        stop();
        await settle();
        expect(plugin.liveCount()).toBe(0);
    });

    for (const reason of ['cancelled', 'interrupted', 'error']) {
        it(`reports a ${reason} close once, detaches, and needs no stop call`, async () => {
            const plugin = fakePlugin();
            __setNativeVaultForTests(plugin);
            const onValue = vi.fn();
            const onClosed = vi.fn();
            const stop = await startNativeQrScan(onValue, onClosed);

            plugin.emit('qrScanClosed', { reason });
            await settle();
            expect(onClosed).toHaveBeenCalledTimes(1);
            expect(onClosed).toHaveBeenCalledWith(reason);
            expect(plugin.liveCount()).toBe(0);

            plugin.emit('qrFrame', { value: 'after close' });
            expect(onValue).not.toHaveBeenCalled();

            stop();
            await settle();
            expect(plugin.qrScanStop).not.toHaveBeenCalled();
        });
    }

    it('reports a close the plugin sends right after the start resolves', async () => {
        let plugin;
        plugin = fakePlugin({
            start: async () => {
                queueMicrotask(() => plugin.emit('qrScanClosed', { reason: 'interrupted' }));
                return { started: true };
            },
        });
        __setNativeVaultForTests(plugin);
        const onClosed = vi.fn();
        const stop = await startNativeQrScan(() => {}, onClosed);
        await settle();
        expect(onClosed).toHaveBeenCalledWith('interrupted');
        stop();
        await settle();
        expect(plugin.qrScanStop).not.toHaveBeenCalled();
        expect(plugin.liveCount()).toBe(0);
    });

    it('reads an unknown close reason as an error', async () => {
        const plugin = fakePlugin();
        __setNativeVaultForTests(plugin);
        const onClosed = vi.fn();
        await startNativeQrScan(() => {}, onClosed);
        plugin.emit('qrScanClosed', { reason: 'something new' });
        expect(onClosed).toHaveBeenCalledWith('error');
    });

    for (const reason of ['denied', 'unavailable', 'busy', 'stopped']) {
        it(`rejects with reason ${reason} and leaves no listener behind`, async () => {
            const plugin = fakePlugin({ start: rejection(reason) });
            __setNativeVaultForTests(plugin);
            const onValue = vi.fn();
            const onClosed = vi.fn();

            await expect(startNativeQrScan(onValue, onClosed)).rejects.toMatchObject({ reason });
            await settle();
            expect(plugin.liveCount()).toBe(0);
            expect(plugin.qrScanStop).not.toHaveBeenCalled();

            plugin.emit('qrFrame', { value: 'stray' });
            plugin.emit('qrScanClosed', { reason: 'cancelled' });
            expect(onValue).not.toHaveBeenCalled();
            expect(onClosed).not.toHaveBeenCalled();
        });
    }

    it('maps any other rejection to error', async () => {
        const plugin = fakePlugin({ start: rejection('session exploded') });
        __setNativeVaultForTests(plugin);
        await expect(startNativeQrScan(() => {}, () => {})).rejects.toMatchObject({ reason: 'error' });
    });

    it('is unavailable without a plugin, or with one that cannot scan', async () => {
        __setNativeVaultForTests(null);
        await expect(startNativeQrScan(() => {}, () => {})).rejects.toMatchObject({ reason: 'unavailable' });

        const plugin = fakePlugin();
        delete plugin.qrScanStart;
        __setNativeVaultForTests(plugin);
        await expect(startNativeQrScan(() => {}, () => {})).rejects.toMatchObject({ reason: 'unavailable' });
        expect(plugin.addListener).not.toHaveBeenCalled();
    });
});

describe('startFailureReason', () => {
    it('reads the reason from the message or the code', () => {
        expect(startFailureReason(new Error('denied'))).toBe('denied');
        expect(startFailureReason({ message: 'x', code: 'busy' })).toBe('busy');
        expect(startFailureReason(new Error('denied by policy'))).toBe('error');
        expect(startFailureReason(undefined)).toBe('error');
    });
});

describe('installNativeQrScanner', () => {
    it('registers nothing in a browser', () => {
        __setNativeVaultForTests(null);
        expect(installNativeQrScanner()).toBe(false);
        expect(getNativeQrScanner()).toBe(null);
    });

    it('registers nothing for a shell plugin without qrScanStart (Android)', () => {
        const plugin = fakePlugin();
        delete plugin.qrScanStart;
        __setNativeVaultForTests(plugin);
        expect(installNativeQrScanner()).toBe(false);
        expect(getNativeQrScanner()).toBe(null);
    });

    it('registers the adapter with core on the iOS shell', () => {
        __setNativeVaultForTests(fakePlugin());
        expect(installNativeQrScanner()).toBe(true);
        expect(getNativeQrScanner()).toBe(nativeQrScanner);
    });
});
