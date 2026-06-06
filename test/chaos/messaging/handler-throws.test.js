// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Chaos: a registered messaging handler throws. The host must convert
// the exception into a structured error response (not a hung promise
// or an unhandled rejection that takes down the page).

import { describe, it, expect } from 'vitest';

// Minimal in-page host that mirrors the wallet's createBackgroundHost
// contract — register(name, handler) + send(name, payload). The real
// host adds dedup, queueing, pending-call accounting; for this chaos
// test the surface we care about is: handler throw → caller .catch().
function createHost() {
    const handlers = new Map();
    return {
        register(name, fn) { handlers.set(name, fn); },
        async send(name, payload) {
            const fn = handlers.get(name);
            if (!fn) throw new Error(`no handler for "${name}"`);
            return fn(payload);
        },
    };
}

describe('chaos/messaging/handler-throws', () => {
    it('a synchronous throw becomes a rejected promise', async () => {
        const host = createHost();
        host.register('explode', () => { throw new Error('boom'); });
        await expect(host.send('explode', null)).rejects.toThrow(/boom/);
    });

    it('an async rejection propagates as the same rejection', async () => {
        const host = createHost();
        host.register('async-explode', async () => { throw new Error('async-boom'); });
        await expect(host.send('async-explode', null)).rejects.toThrow(/async-boom/);
    });

    it('subsequent calls to the same handler still work after one failed', async () => {
        const host = createHost();
        let n = 0;
        host.register('flaky', () => {
            n += 1;
            if (n === 1) throw new Error('first call only');
            return n;
        });
        await expect(host.send('flaky', null)).rejects.toThrow();
        const ok = await host.send('flaky', null);
        expect(ok).toBe(2);
    });

    it('an unknown handler name surfaces immediately', async () => {
        const host = createHost();
        await expect(host.send('nope', null)).rejects.toThrow(/no handler/);
    });
});
