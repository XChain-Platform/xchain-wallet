// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
// Unit: test/e2e/fixtures/gasToken.js - the off-BTC gas bootstrap.
//
// The indexer refuses an XCHAIN ISSUE on every chain but Bitcoin, so a Litecoin
// or Dogecoin venue gets its gas row only from an XBRIDGE v0 lock settled from
// Bitcoin regtest, the e2e harness's own self-seed shape. These cases pin the
// lock parameters and the presence probe each chain uses.

import { afterEach, describe, expect, it } from 'vitest';
import { gasBridgeParams, probeGasToken } from '../../e2e/fixtures/gasToken.js';

const realFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = realFetch;
});

describe('gas bootstrap off Bitcoin', () => {
    it('locks with the harness XBRIDGE v0 shape', () => {
        expect(gasBridgeParams('RDOGE', 'n-destination')).toEqual({
            VERSION: '0',
            DEST_COIN: 'DOGE',
            DEST_ADDRESS: 'n-destination',
            AMOUNT: '5000',
        });
        expect(gasBridgeParams('RLTC', 'r-destination').DEST_COIN).toBe('LTC');
        expect(() => gasBridgeParams('RBTC', 'bcrt-destination')).toThrow(/not bridged/);
        expect(() => gasBridgeParams('RDOGE', '')).toThrow(/destination address/);
    });

    it('reads off-BTC presence from the bridged token row, not a MINT quote', async () => {
        let requested = '';
        globalThis.fetch = async (url) => {
            requested = String(url);
            return { ok: true, status: 200, json: async () => ({ info: { tick: 'XCHAIN' } }) };
        };
        expect(await probeGasToken('RDOGE')).toBe('present');
        expect(requested).toMatch(/\/RDOGE\/api\/token\/XCHAIN$/);
        expect(requested).not.toMatch(/feequote/);
    });

    it('reads the explorer null body and a 404 as absent', async () => {
        for (const response of [
            { ok: true, status: 200, json: async () => null },
            { ok: false, status: 404, json: async () => ({ code: 'NOT_FOUND' }) },
        ]) {
            globalThis.fetch = async () => response;
            expect(await probeGasToken('RDOGE')).toBe('absent');
        }
    });

    it('refuses to guess on any other token lookup answer', async () => {
        globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
        await expect(probeGasToken('RDOGE')).rejects.toThrow(/cannot tell whether XCHAIN exists on RDOGE/);
    });

    it('keeps the open-faucet MINT probe on Bitcoin and quotes from the given source', async () => {
        let requested = '';
        globalThis.fetch = async (url) => {
            requested = String(url);
            return { json: async () => ({ status: 'valid' }) };
        };
        expect(await probeGasToken('RBTC', 'bcrt-source')).toBe('present');
        expect(requested).toMatch(/\/RBTC\/api\/feequote\?/);
        expect(requested).toMatch(/(?:^|&)source=bcrt-source(?:&|$)/);
    });
});
