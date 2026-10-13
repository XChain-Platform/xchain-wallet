// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { sendMessage } from '../../../packages/extension/src/shared/chromeMessaging.js';
import {
    applySurfaceStateEvent,
    attachSurfaceStateListener,
    createSurfaceStateBroadcaster,
    SURFACE_STATE_STORAGE_KEY,
} from '../../../packages/extension/src/shared/surfaceStateSync.js';

function sessionStorageBus() {
    const listeners = new Set();
    const emit = (updates, areaName = 'session') => {
        for (const listener of listeners) listener(updates, areaName);
    };
    const onChanged = {
        addListener(fn) { listeners.add(fn); },
        removeListener(fn) { listeners.delete(fn); },
    };
    const storageArea = {
        set: vi.fn((record, callback) => {
            const value = record[SURFACE_STATE_STORAGE_KEY];
            emit({ [SURFACE_STATE_STORAGE_KEY]: { newValue: value } });
            callback?.();
        }),
    };
    return { emit, onChanged, storageArea };
}

function surface() {
    const calls = {
        refreshSession: vi.fn(),
        selectWallet: vi.fn(),
        settingsChanged: vi.fn(),
        remountNetworkState: vi.fn(),
    };
    return {
        calls,
        receive: (event) => applySurfaceStateEvent(event, calls),
    };
}

describe('extension popup and side-panel state synchronization', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('delivers lock, wallet, settings and network changes to every open surface', async () => {
        const bus = sessionStorageBus();
        const popup = surface();
        const sidePanel = surface();
        const detachPopup = attachSurfaceStateListener(popup.receive, bus.onChanged);
        attachSurfaceStateListener(sidePanel.receive, bus.onChanged);
        const events = createSurfaceStateBroadcaster({
            storageArea: bus.storageArea,
            runtime: {},
            now: () => 10,
        });
        const settings = { activeNetwork: 'testnet' };

        await events.publish('session', { state: 'locked' });
        await events.publish('wallet', { walletId: 'wallet-two' });
        await events.publish('settings', { settings });
        await events.publish('network', { settings });

        for (const openSurface of [popup, sidePanel]) {
            expect(openSurface.calls.refreshSession).toHaveBeenCalledTimes(1);
            expect(openSurface.calls.selectWallet).toHaveBeenCalledWith('wallet-two');
            expect(openSurface.calls.settingsChanged).toHaveBeenCalledTimes(2);
            expect(openSurface.calls.settingsChanged).toHaveBeenCalledWith(settings);
            expect(openSurface.calls.remountNetworkState).toHaveBeenCalledTimes(1);
        }
        const revisions = bus.storageArea.set.mock.calls.map(
            ([record]) => record[SURFACE_STATE_STORAGE_KEY].revision,
        );
        expect(new Set(revisions).size).toBe(4);

        detachPopup();
        await events.publish('session', { state: 'unlocked' });
        expect(popup.calls.refreshSession).toHaveBeenCalledTimes(1);
        expect(sidePanel.calls.refreshSession).toHaveBeenCalledTimes(2);
    });

    it('syncs a successful side-panel settings write to an open popup through chrome storage', async () => {
        const bus = sessionStorageBus();
        const popup = surface();
        const settings = { theme: 'dark', fiatCurrency: 'EUR' };
        const runtime = {
            sendMessage: vi.fn((_message, callback) => callback({ ok: true, result: settings })),
        };
        vi.stubGlobal('chrome', {
            runtime,
            storage: { session: bus.storageArea, onChanged: bus.onChanged },
        });
        const detachPopup = attachSurfaceStateListener(popup.receive);

        await expect(sendMessage('settings.update', { patch: { theme: 'dark' } }))
            .resolves.toEqual(settings);
        await vi.waitFor(() => {
            expect(popup.calls.settingsChanged).toHaveBeenCalledWith(settings);
        });
        expect(runtime.sendMessage).toHaveBeenCalledWith(
            { type: 'settings.update', request: { patch: { theme: 'dark' } } },
            expect.any(Function),
        );
        expect(popup.calls.remountNetworkState).not.toHaveBeenCalled();

        popup.calls.settingsChanged.mockClear();
        runtime.sendMessage.mockImplementationOnce((_message, callback) => callback({
            ok: false,
            error: { name: 'Error', message: 'write refused' },
        }));
        await expect(sendMessage('settings.update', { patch: { theme: 'light' } }))
            .rejects.toThrow('write refused');
        expect(popup.calls.settingsChanged).not.toHaveBeenCalled();

        detachPopup();
    });

    it('ignores unrelated storage areas and malformed events', () => {
        const bus = sessionStorageBus();
        const receive = vi.fn();
        attachSurfaceStateListener(receive, bus.onChanged);

        bus.emit({ [SURFACE_STATE_STORAGE_KEY]: { newValue: {
            kind: 'wallet', payload: { walletId: 'wallet-two' }, revision: '1',
        } } }, 'local');
        bus.emit({ [SURFACE_STATE_STORAGE_KEY]: { newValue: {
            kind: 'unknown', payload: {}, revision: '2',
        } } });
        bus.emit({ [SURFACE_STATE_STORAGE_KEY]: { newValue: {
            kind: 'wallet', payload: null, revision: '3',
        } } });

        expect(receive).not.toHaveBeenCalled();
    });
});

function makeHost(surfaceStateEvents) {
    const settings = createDefaultSettings();
    const wallet = { id: 'wallet-two' };
    const vault = {
        wallets: {
            get: async (id) => (id === wallet.id ? wallet : null),
        },
        accounts: { findBy: async () => [] },
        connectedSites: { list: async () => [] },
        settings: {
            async get() { return structuredClone(settings); },
            async put(next) { Object.assign(settings, structuredClone(next)); },
        },
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry: {},
        sdkRegistry: {},
        bridgeEvents: { walletSwitched: vi.fn() },
        surfaceStateEvents,
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host };
}

describe('background mutation notifications', () => {
    it('publishes validated wallet switches after the host accepts them', async () => {
        const surfaceStateEvents = { publish: vi.fn(async () => true) };
        const { host } = makeHost(surfaceStateEvents);

        const accepted = await host.handle({
            type: 'wallet.setActive',
            request: { walletId: 'wallet-two' },
        });
        const refused = await host.handle({
            type: 'wallet.setActive',
            request: { walletId: 'missing' },
        });

        expect(accepted.ok).toBe(true);
        expect(refused.ok).toBe(false);
        expect(surfaceStateEvents.publish).toHaveBeenCalledTimes(1);
        expect(surfaceStateEvents.publish).toHaveBeenCalledWith(
            'wallet',
            { walletId: 'wallet-two' },
        );
    });

    it('publishes the persisted settings from the active-network route', async () => {
        const surfaceStateEvents = { publish: vi.fn(async () => true) };
        const { host } = makeHost(surfaceStateEvents);

        const response = await host.handle({
            type: 'settings.setActiveNetwork',
            request: { network: 'testnet' },
        });

        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(response.result.settings.activeNetwork).toBe('testnet');
        expect(surfaceStateEvents.publish).toHaveBeenCalledWith(
            'network',
            { settings: expect.objectContaining({ activeNetwork: 'testnet' }) },
        );
    });
});
