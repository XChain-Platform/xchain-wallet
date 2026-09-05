// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The host's boot pass for user-added chains, driven through the real host
// object. Two contracts a source-scanning smoke cannot see, because both are
// about WHEN a read lands rather than what the source says:
//
//   1. The seed latch belongs to a COMPLETED read. The popup's first
//      settings.get arrives while the vault is still locked, which is the
//      exact case the seed's own catch anticipates, so a latch set before
//      the read strands every persisted custom chain for the life of the
//      service worker: the registry never learns them and no later unlock
//      brings them back.
//   2. The endpoint-override pass runs after the seed. SDKRegistry drops
//      overrides for chain ids its chain registry does not know AND replaces
//      the whole override map, so an override pass that reaches the vault
//      first silently discards a user-added chain's operator endpoints for
//      the session; every request on that chain then goes to the bundled
//      default with no symptom.

import { describe, it, expect, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { ChainRegistry, BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import { SDKRegistry, joinEndpoint } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const template = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');
const CUSTOM = { ...template, id: 'operator-regtest', displayName: 'Operator' };
const OPERATOR_EXPLORER = 'http://10.0.0.9:18080';

/** Drain every pending microtask chain the fire-and-forget passes leave behind. */
async function flush(rounds = 200) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

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

/**
 * A settings record carrying one user-added chain and an operator endpoint
 * override for it, which is the pairing the two contracts above interact over.
 */
function persistedRecord() {
    const rec = createDefaultSettings();
    rec.customChains = [CUSTOM];
    rec.sdkEndpoints = {
        [CUSTOM.id]: {
            explorerUrl: OPERATOR_EXPLORER,
            encoderUrl: joinEndpoint(CUSTOM.encoder),
            hubUrl: joinEndpoint(CUSTOM.hub),
            custom: true,
        },
    };
    return rec;
}

/**
 * @param {{ locked?: boolean, reverseReadOrder?: boolean }} [opts]
 *   `locked` makes every settings read throw until the test clears it, the
 *   way a vault behaves before the user unlocks. `reverseReadOrder` makes
 *   later-issued reads resolve FIRST: the extension's backing store answers
 *   over IPC, so completion order is not issue order, and the sequencing is
 *   what has to hold when it is not.
 */
function makeHost({ locked = false, reverseReadOrder = false } = {}) {
    let record = persistedRecord();
    const vault = {
        locked,
        reads: 0,
        wallets: memCollection(),
        accounts: memCollection(),
        addresses: memCollection(),
        signers: memCollection(),
        settings: {
            get: vi.fn(async () => {
                vault.reads += 1;
                const stagger = reverseReadOrder ? Math.max(0, 12 - vault.reads) : 0;
                for (let i = 0; i < stagger; i += 1) await Promise.resolve();
                if (vault.locked) throw new Error('vault is locked');
                return JSON.parse(JSON.stringify(record));
            }),
            put: vi.fn(async (r) => { record = JSON.parse(JSON.stringify(r)); }),
        },
    };
    const chainRegistry = new ChainRegistry();
    const addCustom = vi.spyOn(chainRegistry, 'addCustom');
    const sdkCalls = [];
    const sdkRegistry = new SDKRegistry({
        chainRegistry,
        sdkFactory: (opts) => { sdkCalls.push(opts); return { network: opts.network }; },
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
    const settingsGet = () => host.handle({ type: 'settings.get', request: {} });
    return { host, vault, chainRegistry, addCustom, sdkRegistry, sdkCalls, settingsGet };
}

describe('custom-chain seed retries after a failed read', () => {
    it('installs the persisted chain on the settings.get that follows an unlock', async () => {
        const h = makeHost({ locked: true });

        const first = await h.settingsGet();
        expect(first.ok).toBe(false);
        await flush();
        expect(h.addCustom).not.toHaveBeenCalled();
        expect(h.chainRegistry.has(CUSTOM.id)).toBe(false);

        h.vault.locked = false;
        const second = await h.settingsGet();
        expect(second.ok, JSON.stringify(second.error ?? {})).toBe(true);
        await flush();

        expect(h.addCustom).toHaveBeenCalledTimes(1);
        expect(h.addCustom.mock.calls[0][0]).toMatchObject({ id: CUSTOM.id });
        expect(h.chainRegistry.has(CUSTOM.id)).toBe(true);
    });

    it('installs the persisted chain exactly once when every read succeeds', async () => {
        const h = makeHost();

        expect((await h.settingsGet()).ok).toBe(true);
        await flush();
        expect((await h.settingsGet()).ok).toBe(true);
        await flush();

        expect(h.addCustom).toHaveBeenCalledTimes(1);
        expect(h.chainRegistry.has(CUSTOM.id)).toBe(true);
    });
});

describe('operator endpoints survive on a user-added chain', () => {
    it('applies the override on the settings.get that follows an unlock', async () => {
        const h = makeHost({ locked: true });

        expect((await h.settingsGet()).ok).toBe(false);
        await flush();

        h.vault.locked = false;
        expect((await h.settingsGet()).ok).toBe(true);
        await flush();

        h.sdkRegistry.get(CUSTOM.id);
        expect(h.sdkCalls.at(-1).explorerUrl).toBe(OPERATOR_EXPLORER);
    });

    it('applies the override when the override read would otherwise land first', async () => {
        const h = makeHost({ reverseReadOrder: true });
        // Drain the construction-time best-effort pass, which runs before any
        // seed by design and can only see the bundled set.
        await flush();

        expect((await h.settingsGet()).ok).toBe(true);
        await flush();

        expect(h.chainRegistry.has(CUSTOM.id)).toBe(true);
        h.sdkRegistry.get(CUSTOM.id);
        expect(h.sdkCalls.at(-1).explorerUrl).toBe(OPERATOR_EXPLORER);
    });
});
