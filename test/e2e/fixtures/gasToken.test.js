// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { gasBridgeParams, probeGasToken } from './gasToken.js';

const realFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = realFetch;
});

test('the off-BTC bootstrap uses the harness XBRIDGE v0 lock shape', () => {
    assert.deepEqual(gasBridgeParams('RDOGE', 'n-destination'), {
        VERSION: '0',
        DEST_COIN: 'DOGE',
        DEST_ADDRESS: 'n-destination',
        AMOUNT: '5000',
    });
    assert.throws(() => gasBridgeParams('RBTC', 'bcrt-destination'), /not bridged/);
});

test('off-BTC presence is read from the bridged token row, not a MINT quote', async () => {
    let requested = '';
    globalThis.fetch = async (url) => {
        requested = String(url);
        return {
            ok: true,
            status: 200,
            json: async () => ({ info: { tick: 'XCHAIN' } }),
        };
    };

    assert.equal(await probeGasToken('RDOGE'), 'present');
    assert.match(requested, /\/RDOGE\/api\/token\/XCHAIN$/);
    assert.doesNotMatch(requested, /feequote/);
});

test('off-BTC absence accepts the explorer null and 404 shapes', async () => {
    for (const response of [
        { ok: true, status: 200, json: async () => null },
        { ok: false, status: 404, json: async () => ({ code: 'NOT_FOUND' }) },
    ]) {
        globalThis.fetch = async () => response;
        assert.equal(await probeGasToken('RDOGE'), 'absent');
    }
});

test('Bitcoin presence keeps the open-faucet MINT probe and uses its source', async () => {
    let requested = '';
    globalThis.fetch = async (url) => {
        requested = String(url);
        return { json: async () => ({ status: 'valid' }) };
    };

    assert.equal(await probeGasToken('RBTC', 'bcrt-source'), 'present');
    assert.match(requested, /\/RBTC\/api\/feequote\?/);
    assert.match(requested, /(?:^|&)source=bcrt-source(?:&|$)/);
});
