// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// At the host boundary: Settings -> Network & Endpoints wrote
// `settings.sdkEndpoints` and the summary row said "1 chain custom",
// but no code path ever handed that record to SDKRegistry, so every
// request still went to the bundled default. An operator pointing the
// wallet at their own node was ignored without a symptom.
//
// The host is the single funnel all three shells share (extension
// background, web hostBridge, desktop messageHost), so the wiring is
// asserted here rather than three times over.

import { describe, it, expect } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { SDKRegistry, joinEndpoint } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const chainRegistry = defaultRegistry();
const CHAIN = 'litecoin-regtest';
const descriptor = chainRegistry.get(CHAIN);

function memCollection() {
    const m = new Map();
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()),
        delete: async (id) => { m.delete(id); },
        find: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        findBy: async () => [],
    };
}

function makeHost(initialSettings = createDefaultSettings()) {
    const vault = {
        wallets: memCollection(),
        accounts: memCollection(),
        addresses: memCollection(),
        signers: memCollection(),
        settings: {
            _rec: JSON.parse(JSON.stringify(initialSettings)),
            async get() { return JSON.parse(JSON.stringify(this._rec)); },
            async put(r) { this._rec = JSON.parse(JSON.stringify(r)); },
        },
    };
    const calls = [];
    const sdkRegistry = new SDKRegistry({
        chainRegistry,
        sdkFactory: (opts) => { calls.push(opts); return { network: opts.network }; },
    });
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry,
        signerPool: { get: () => null, has: () => false },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, vault, sdkRegistry, calls };
}

const customEntry = (explorerUrl) => ({
    explorerUrl,
    encoderUrl: joinEndpoint(descriptor.encoder),
    hubUrl: joinEndpoint(descriptor.hub),
    custom: true,
});

describe('Saved endpoints reach the SDK registry', () => {
    it('applies a settings.update that carries sdkEndpoints', async () => {
        const { host, sdkRegistry, calls } = makeHost();
        sdkRegistry.get(CHAIN);
        expect(calls[0].explorerUrl).toBe(joinEndpoint(descriptor.explorer));

        const res = await host.handle({
            type: 'settings.update',
            request: { patch: { sdkEndpoints: { [CHAIN]: customEntry('http://10.0.0.9:18080') } } },
        });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);

        sdkRegistry.get(CHAIN);
        const last = calls[calls.length - 1];
        expect(last.explorerUrl).toBe('http://10.0.0.9:18080');
        // The fields the operator did not touch keep their default ports.
        expect(last.encoderUrl).toBe(joinEndpoint(descriptor.encoder));
        expect(last.hubUrl).toBe(joinEndpoint(descriptor.hub));
    });

    it('adopts an already-persisted override without waiting for an edit', async () => {
        const persisted = createDefaultSettings();
        persisted.sdkEndpoints[CHAIN] = customEntry('http://10.0.0.9:18080');
        const { host, sdkRegistry, calls } = makeHost(persisted);

        // settings.get is what the UI calls right after unlock.
        const res = await host.handle({ type: 'settings.get', request: {} });
        expect(res.ok).toBe(true);
        await Promise.resolve();

        sdkRegistry.get(CHAIN);
        expect(calls[calls.length - 1].explorerUrl).toBe('http://10.0.0.9:18080');
    });

    it('leaves live instances in place when a save does not touch endpoints', async () => {
        const { host, sdkRegistry } = makeHost();
        const before = sdkRegistry.get(CHAIN);
        const res = await host.handle({
            type: 'settings.update',
            request: { patch: { theme: 'dark' } },
        });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(sdkRegistry.get(CHAIN)).toBe(before);
    });
});
