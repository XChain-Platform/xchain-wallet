// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A saved endpoint override drops the chain's SDK instance, and a shell that
// holds a live socket on it is told through onSdkEndpointsChanged. The hook is
// not a network surface event: that one remounts the popup's network state.
// It fires only when an instance was actually dropped.

import { describe, it, expect, vi } from 'vitest';
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

function makeHost({ hookThrows = false } = {}) {
    const vault = {
        wallets: memCollection(),
        accounts: memCollection(),
        addresses: memCollection(),
        signers: memCollection(),
        settings: {
            _rec: JSON.parse(JSON.stringify(createDefaultSettings())),
            async get() { return JSON.parse(JSON.stringify(this._rec)); },
            async put(r) { this._rec = JSON.parse(JSON.stringify(r)); },
        },
    };
    const sdkRegistry = new SDKRegistry({
        chainRegistry,
        sdkFactory: (opts) => ({ network: opts.network }),
    });
    const published = [];
    const dropped = [];
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry,
        signerPool: { get: () => null, has: () => false },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        surfaceStateEvents: { publish: async (kind) => { published.push(kind); } },
        onSdkEndpointsChanged: async (ids) => {
            if (hookThrows) throw new Error('boom');
            dropped.push(...ids);
        },
    });
    return { host, published, dropped };
}

const customEntry = (explorerUrl) => ({
    explorerUrl,
    encoderUrl: joinEndpoint(descriptor.encoder),
    hubUrl: joinEndpoint(descriptor.hub),
    custom: true,
});

const update = (host, patch) => host.handle({ type: 'settings.update', request: { patch } });

describe('A saved endpoint override tells the shell to re-sync its sockets', () => {
    it('reports the chain whose endpoint moved, and publishes no network event', async () => {
        const { host, published, dropped } = makeHost();
        const res = await update(host, { sdkEndpoints: { [CHAIN]: customEntry('http://10.0.0.9:18080') } });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(dropped).toEqual([CHAIN]);
        expect(published).not.toContain('network');
    });

    it('reports nothing for a save that leaves every endpoint where it was', async () => {
        const { host, dropped } = makeHost();
        const res = await update(host, { sdkEndpoints: {} });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(dropped).toEqual([]);
    });

    it('reports nothing for a save that does not touch endpoints', async () => {
        const { host, dropped } = makeHost();
        await update(host, { theme: 'dark' });
        expect(dropped).toEqual([]);
    });

    it('still saves when the follow-up hook throws', async () => {
        const { host } = makeHost({ hookThrows: true });
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const res = await update(host, { sdkEndpoints: { [CHAIN]: customEntry('http://10.0.0.9:18080') } });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(logged).toHaveBeenCalledTimes(1);
        logged.mockRestore();
    });
});
