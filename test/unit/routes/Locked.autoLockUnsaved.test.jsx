// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The extension locks the wallet when storage refuses its auto-lock arm, and
// the Locked screen says so once; any other lock shows no reason.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import {
    attachAutoLockUnsavedListener,
    announceAutoLockUnsaved,
    AUTO_LOCK_UNSAVED_MESSAGE,
} from '../../../packages/extension/src/shared/surfaceStateSync.js';

const NOTICE = "The wallet locked because its auto-lock timer couldn't be saved.";

function mount(lockReason) {
    render(
        <MessagingProvider shell="popup" messaging={{ unlockWallet: vi.fn() }}>
            <Locked onUnlocked={vi.fn()} lockReason={lockReason} />
        </MessagingProvider>,
    );
}

afterEach(() => { cleanup(); });

describe('Locked screen lock reason', () => {
    it('shows one notice when the auto-lock timer could not be saved', () => {
        mount('auto-lock-unsaved');
        expect(screen.getAllByText(NOTICE)).toHaveLength(1);
    });

    it('shows no reason for an ordinary lock', () => {
        mount(null);
        expect(screen.queryByText(NOTICE)).toBeNull();
    });
});

describe('auto-lock unsaved announcement', () => {
    function fakeRuntime() {
        const listeners = new Set();
        return {
            listeners,
            onMessage: {
                addListener: (fn) => listeners.add(fn),
                removeListener: (fn) => listeners.delete(fn),
            },
            async sendMessage(message) {
                for (const fn of listeners) {
                    fn(message, {
                        id: 'own-id',
                        origin: 'chrome-extension://own-id',
                        url: 'chrome-extension://own-id/background.js',
                    });
                }
            },
        };
    }

    it('reaches a surface listener without touching storage', async () => {
        const runtime = fakeRuntime();
        const onUnsaved = vi.fn();
        const prior = globalThis.chrome;
        globalThis.chrome = { runtime: { id: 'own-id' } };
        try {
            const detach = attachAutoLockUnsavedListener(onUnsaved, runtime.onMessage);
            await announceAutoLockUnsaved(runtime);
            expect(onUnsaved).toHaveBeenCalledTimes(1);
            detach();
            expect(runtime.listeners.size).toBe(0);
        } finally {
            globalThis.chrome = prior;
        }
    });

    it('accepts extension origins and refuses content-script origins', () => {
        const runtime = fakeRuntime();
        const onUnsaved = vi.fn();
        const prior = globalThis.chrome;
        globalThis.chrome = { runtime: { id: 'own-id' } };
        try {
            attachAutoLockUnsavedListener(onUnsaved, runtime.onMessage);
            const [listener] = runtime.listeners;
            listener({ type: 'something-else' }, { origin: 'chrome-extension://own-id' });
            listener({ type: AUTO_LOCK_UNSAVED_MESSAGE }, { origin: 'chrome-extension://other-id' });
            listener({ type: AUTO_LOCK_UNSAVED_MESSAGE }, {
                id: 'own-id',
                origin: 'https://example.test',
                url: 'https://example.test/',
                tab: { id: 7 },
            });
            expect(onUnsaved).not.toHaveBeenCalled();
            listener({ type: AUTO_LOCK_UNSAVED_MESSAGE }, { origin: 'chrome-extension://own-id' });
            listener({ type: AUTO_LOCK_UNSAVED_MESSAGE }, { url: 'chrome-extension://own-id/background.js' });
            expect(onUnsaved).toHaveBeenCalledTimes(2);
            globalThis.chrome = { runtime: {} };
            listener({ type: AUTO_LOCK_UNSAVED_MESSAGE }, { origin: 'chrome-extension://own-id' });
            expect(onUnsaved).toHaveBeenCalledTimes(2);
        } finally {
            globalThis.chrome = prior;
        }
    });

    it('settles when no surface is open to receive it', async () => {
        await expect(announceAutoLockUnsaved({
            sendMessage: async () => { throw new Error('Receiving end does not exist.'); },
        })).resolves.toBeUndefined();
    });
});
