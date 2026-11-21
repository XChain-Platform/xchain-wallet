// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createNativeNotifyAdapter,
    NATIVE_NOTIFY_ACTION_EVENT,
} from '../../../packages/web/src/notifications/nativeNotifyAdapter.js';

function installPlugin() {
    let emitAction;
    const plugin = {
        post: vi.fn(async () => ({ posted: true })),
        schedule: vi.fn(async () => ({ scheduled: true })),
        cancel: vi.fn(async () => ({ cancelled: true })),
        addListener: vi.fn((name, handler) => {
            emitAction = handler;
            return Promise.resolve({ remove: vi.fn() });
        }),
    };
    vi.stubGlobal('Capacitor', {
        isNativePlatform: () => true,
        Plugins: { XChainNotify: plugin },
    });
    return { plugin, emitAction: (event) => emitAction(event) };
}

describe('nativeNotifyAdapter', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('posts the native family, bundled sound, category, thread and actions', async () => {
        const { plugin } = installPlugin();
        const notify = createNativeNotifyAdapter();
        const actions = [{ id: 'openOnPhone', title: 'Open on phone' }];

        await notify({
            id: 'request-7',
            kind: 'coinpay-required',
            title: 'Payment due',
            body: '12 XCP is due.',
            sound: { id: 'chime', file: 'chime.mp3' },
            category: 'paydue',
            threadId: 'order-3',
            actions,
        });

        expect(plugin.post).toHaveBeenCalledWith({
            id: 'request-7',
            title: 'Payment due',
            body: '12 XCP is due.',
            family: 'incomingReceipts',
            sound: 'chime',
            category: 'paydue',
            threadId: 'order-3',
            actions,
        });
    });

    it('passes scheduling and cancellation through the plugin', async () => {
        const { plugin } = installPlugin();
        const notify = createNativeNotifyAdapter();

        await notify.schedule({
            id: 'deadline-4', kind: 'deadline', title: 'Deadline', body: 'One hour left.',
        }, 1_800_000_000_000);
        await notify.cancel('deadline-4');

        expect(plugin.schedule).toHaveBeenCalledWith(expect.objectContaining({
            id: 'deadline-4', family: 'deadlines', at: 1_800_000_000_000,
        }));
        expect(plugin.cancel).toHaveBeenCalledWith({ id: 'deadline-4' });
    });

    it('delivers Open on phone to every registered plain handler until unsubscribed', () => {
        const { plugin, emitAction } = installPlugin();
        const notify = createNativeNotifyAdapter();
        const first = vi.fn(() => { throw new Error('handler failed'); });
        const second = vi.fn();
        const unsubscribe = notify.onAction(first);
        notify.onAction(second);
        const event = { id: 'request-7', action: 'openOnPhone' };

        emitAction(event);
        unsubscribe();
        emitAction({ ...event, id: 'request-8' });

        expect(plugin.addListener).toHaveBeenCalledOnce();
        expect(plugin.addListener).toHaveBeenCalledWith(NATIVE_NOTIFY_ACTION_EVENT, expect.any(Function));
        expect(first).toHaveBeenCalledTimes(1);
        expect(first).toHaveBeenCalledWith(event);
        expect(second).toHaveBeenCalledTimes(2);
    });

    it('is inert outside a native shell', () => {
        vi.stubGlobal('Capacitor', { isNativePlatform: () => false, Plugins: {} });
        const notify = createNativeNotifyAdapter();
        expect(notify({ kind: 'deadline' })).toBe(false);
        expect(notify.schedule({ kind: 'deadline', at: 1 })).toBe(false);
        expect(notify.cancel('deadline-1')).toBe(false);
    });
});
