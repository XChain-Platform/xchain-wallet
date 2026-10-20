// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The ConfirmSession typedef names exactly the keys the put route stores.
//
// Nothing typechecks these packages, so that typedef is the only written
// contract for a stored confirm, and it drifted: it listed four fields while
// the route stored six, omitting the `dispatch` and `createdAt` that resume
// signs with and expires on. This drives the real route against a fake
// session store and reads the @property names back out of the source.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const STORAGE_SRC = join(process.cwd(), 'packages', 'extension', 'src', 'background',
    'confirmActionSessionStorage.js');

afterEach(() => { delete globalThis.chrome; });

// Install the fake BEFORE building the host: it picks its store at construction.
function mockChromeSession() {
    const store = {};
    globalThis.chrome = {
        storage: {
            session: {
                get: (key, cb) => cb({ [key]: store[key] }),
                set: (obj, cb) => { Object.assign(store, obj); cb(); },
            },
        },
    };
    return store;
}

function documentedSessionKeys() {
    const src = readFileSync(STORAGE_SRC, 'utf8');
    const start = src.indexOf('@typedef {Object} ConfirmSession');
    expect(start, 'ConfirmSession is declared with one @property per field').toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('*/', start));
    // Greedy to the LAST brace on the line: the dispatch type nests braces of its own.
    return [...block.matchAll(/^\s*\*\s*@property\s+\{.+\}\s+(\w+)/gm)].map((m) => m[1]);
}

describe('ConfirmSession typedef', () => {
    it('names exactly the keys action.confirmSession.put stores', async () => {
        const store = mockChromeSession();
        const host = createBackgroundHost({
            vault: { settings: { get: async () => ({}) }, wallets: { list: async () => [] } },
            chainRegistry: { get: () => null, list: () => [] },
            sdkRegistry: { get: () => null },
            broadcastQueueStorage: null,
            signThrottleStorage: null,
            logConsoleStorage: null,
        });
        const put = await host.handle({
            type: 'action.confirmSession.put',
            request: {
                id: 'c1',
                request: {},
                composed: { psbt: 'HEX' },
                report: null,
                dispatch: { software: 'x', base: {} },
                createdAt: 1,
            },
        });
        expect(put).toEqual({ ok: true, result: { supported: true, stored: true } });

        const stored = Object.values(store).find((v) => v && typeof v === 'object' && v.c1)?.c1;
        expect(stored, 'the route wrote the session to chrome.storage.session').toBeTruthy();
        expect([...documentedSessionKeys()].sort()).toEqual(Object.keys(stored).sort());
    });
});
