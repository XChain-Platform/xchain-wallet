// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A custom network added or removed through the host reaches every other open
// extension surface as a `custom-chains` event that carries no settings
// record, so a receiver reads the saved record itself and never trusts a
// payload that could be older than the change.

import { describe, it, expect, vi } from 'vitest';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { ChainRegistry, BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import {
    applySurfaceStateEvent,
    attachSurfaceStateListener,
    createSurfaceStateBroadcaster,
    SURFACE_STATE_STORAGE_KEY,
} from '../../../packages/extension/src/shared/surfaceStateSync.js';

const template = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');
const CUSTOM = { ...template, id: 'operator-regtest', displayName: 'Operator' };

function makeHost() {
    let settings = createDefaultSettings();
    const vault = {
        settings: {
            async get() { return structuredClone(settings); },
            async put(next) { settings = structuredClone(next); },
        },
    };
    const surfaceStateEvents = { publish: vi.fn(async () => true) };
    const host = createBackgroundHost({
        vault,
        chainRegistry: new ChainRegistry(),
        sdkRegistry: { get: () => ({}), dropCached: () => {}, applyEndpointOverridesFromSettings: () => ({ changed: [] }) },
        bridgeEvents: { walletSwitched: vi.fn() },
        surfaceStateEvents,
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, surfaceStateEvents };
}

const customChainEvents = (publish) => publish.mock.calls.filter(([kind]) => kind === 'custom-chains');

describe('custom-chain routes announce their change', () => {
    it('publishes a payload-free custom-chains event after an add and after a removal', async () => {
        const { host, surfaceStateEvents } = makeHost();

        const added = await host.handle({ type: 'chainRegistry.addCustomChain', request: { descriptor: CUSTOM } });
        expect(added.ok, JSON.stringify(added.error ?? {})).toBe(true);
        expect(customChainEvents(surfaceStateEvents.publish)).toEqual([['custom-chains', {}]]);

        const removed = await host.handle({ type: 'chainRegistry.removeCustomChain', request: { chainId: CUSTOM.id } });
        expect(removed.ok).toBe(true);
        expect(removed.result.removed).toBe(true);
        expect(customChainEvents(surfaceStateEvents.publish)).toHaveLength(2);
        expect(surfaceStateEvents.publish.mock.calls.some(([kind]) => kind === 'network')).toBe(false);
    });

    it('announces nothing for a failed add or a removal that changed nothing', async () => {
        const { host, surfaceStateEvents } = makeHost();

        const refused = await host.handle({ type: 'chainRegistry.addCustomChain', request: { descriptor: { id: 'broken' } } });
        const none = await host.handle({ type: 'chainRegistry.removeCustomChain', request: { chainId: 'never-added' } });

        expect(refused.ok).toBe(false);
        expect(none.result?.removed).toBe(false);
        expect(customChainEvents(surfaceStateEvents.publish)).toEqual([]);
    });
});

describe('custom-chains surface event', () => {
    it('is accepted by the broadcaster and the listener and reaches customChainsChanged', async () => {
        let delivered;
        const storageArea = { set: vi.fn((record, callback) => { delivered = record[SURFACE_STATE_STORAGE_KEY]; callback?.(); }) };
        const broadcaster = createSurfaceStateBroadcaster({ storageArea, runtime: {} });
        expect(await broadcaster.publish('custom-chains', {})).toBe(true);

        let listener;
        const received = [];
        attachSurfaceStateListener((event) => received.push(event), {
            addListener: (fn) => { listener = fn; },
            removeListener: () => {},
        });
        listener({ [SURFACE_STATE_STORAGE_KEY]: { newValue: delivered } }, 'session');
        expect(received).toHaveLength(1);

        const customChainsChanged = vi.fn();
        const settingsChanged = vi.fn();
        applySurfaceStateEvent(received[0], { customChainsChanged, settingsChanged });
        expect(customChainsChanged).toHaveBeenCalledTimes(1);
        expect(settingsChanged).not.toHaveBeenCalled();
    });
});

describe('removing the last custom network', () => {
    it('reads back as an empty list, so a sibling realm reconciles it away', async () => {
        const { Vault } = await import('../../../packages/core/src/storage/Vault.js');
        const { InMemoryBackend } = await import('../../../packages/core/src/storage/backend.js');
        const { deriveMasterKey, makeFreshKdfParams } = await import('../../../packages/core/src/crypto/kdf.js');
        const { reconcileCustomChainsFromSettings } = await import('../../../packages/core/src/registry/index.js');
        const { addCustomChain, removeCustomChain } = await import('../../../packages/core/src/flows/customChains.js');
        const vault = new Vault({
            backend: new InMemoryBackend(),
            masterKey: deriveMasterKey('pw', makeFreshKdfParams({ iterations: 1, memory: 8 * 1024 })),
        });
        await vault.open();
        await vault.settings.put(createDefaultSettings());
        const hostRegistry = new ChainRegistry();
        const siblingRealm = new ChainRegistry();
        await addCustomChain({ vault, chainRegistry: hostRegistry, descriptor: CUSTOM });
        reconcileCustomChainsFromSettings(siblingRealm, await vault.settings.get());
        expect(siblingRealm.has(CUSTOM.id)).toBe(true);

        await removeCustomChain({ vault, chainRegistry: hostRegistry, chainId: CUSTOM.id });
        const saved = await vault.settings.get();

        expect(saved.customChains).toEqual([]);
        expect(reconcileCustomChainsFromSettings(siblingRealm, saved).removed).toEqual([CUSTOM.id]);
        expect(siblingRealm.has(CUSTOM.id)).toBe(false);
    });
});
