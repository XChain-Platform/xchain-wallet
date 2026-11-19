// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { createBackgroundHost } from '../../../../packages/extension/src/background/createBackgroundHost.js';

const ORIGIN = 'signer-origin';
const CHAIN_ID = 'bitcoin-regtest';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

async function flushMicrotasks(rounds = 50) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function makeVault({ settings = {}, settingsError = null } = {}) {
    const site = {
        id: 'site-1',
        origin: ORIGIN,
        permissions: {
            chains: [CHAIN_ID],
            accounts: [],
            canSignMessage: false,
            canSignAction: {},
        },
    };
    return {
        settings: {
            get: vi.fn(async () => {
                if (settingsError) throw settingsError;
                return settings;
            }),
        },
        connectedSites: {
            findBy: async (_field, value) => (value === ORIGIN ? [site] : []),
            put: async () => {},
        },
        addresses: { list: async () => [] },
        accounts: { get: async () => null },
        wallets: { list: async () => [] },
    };
}

function makeHost({ vault = makeVault(), signThrottleStorage = null } = {}) {
    return createBackgroundHost({
        vault,
        approvals: { signMessage: async () => ({ approved: false }) },
        chainRegistry: {
            get: () => ({ id: CHAIN_ID, coin: 'bitcoin', networkKind: 'regtest' }),
        },
        sdkRegistry: {},
        signerPool: { get: () => null, has: () => false },
        broadcastQueueStorage: null,
        signThrottleStorage,
        logConsoleStorage: null,
    });
}

function sign(host, message = 'hello') {
    return host.handle({
        type: 'bridge.signMessage',
        request: { origin: ORIGIN, chainId: CHAIN_ID, address: 'address-1', message },
    });
}

describe('sign throttle hydration gate', () => {
    it('waits for persisted buckets before checking the first request', async () => {
        const load = deferred();
        const host = makeHost({
            signThrottleStorage: {
                load: () => load.promise,
                save: async () => {},
            },
        });
        let settled = false;
        const response = sign(host).finally(() => { settled = true; });

        await flushMicrotasks();
        expect(settled).toBe(false);

        const now = Date.now();
        load.resolve({ buckets: { [ORIGIN]: Array(5).fill(now) } });
        await expect(response).resolves.toMatchObject({
            ok: false,
            error: { code: 'THROTTLED' },
        });
    });

    it('uses saved limits without requiring a settings route call', async () => {
        const host = makeHost({
            vault: makeVault({ settings: { signThrottle: { burst: 1, windowMs: 60_000 } } }),
        });

        await expect(sign(host, 'first')).resolves.toMatchObject({ ok: false });
        await expect(sign(host, 'second')).resolves.toMatchObject({
            ok: false,
            error: { code: 'THROTTLED', burst: 1, windowMs: 60_000 },
        });
    });

    it('retries a failed construction read before the first throttle check', async () => {
        const settings = { signThrottle: { burst: 1, windowMs: 60_000 } };
        const vault = makeVault({ settings });
        let locked = true;
        vault.settings.get.mockImplementation(async () => {
            if (locked) throw new Error('settings unavailable');
            return settings;
        });
        const host = makeHost({ vault });
        await flushMicrotasks();
        locked = false;

        await expect(sign(host, 'first')).resolves.toMatchObject({ ok: false });
        await expect(sign(host, 'second')).resolves.toMatchObject({
            ok: false,
            error: { code: 'THROTTLED', burst: 1 },
        });
    });

    it('falls back to defaults when both hydration reads fail', async () => {
        const host = makeHost({
            vault: makeVault({ settingsError: new Error('settings unavailable') }),
            signThrottleStorage: {
                load: async () => { throw new Error('storage unavailable'); },
                save: async () => {},
            },
        });

        const response = await sign(host);
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe('USER_REJECTED');
    });
});
