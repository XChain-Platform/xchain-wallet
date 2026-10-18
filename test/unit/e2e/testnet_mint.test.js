// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
    mintTestnetXchain,
    readTestnetGasHeadroom,
} from '../../e2e/fixtures/testnet_mint.js';

const explorerUrl = 'testnet-explorer';
const coin = 'TBTC';

function reply(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: vi.fn(async () => body),
    };
}

describe('testnet XCHAIN mint headroom', () => {
    it('reads the requested testnet venue and subtracts current supply from its cap', async () => {
        const fetch = vi.fn(async () => reply(200, {
            supply: { max: '1000.25', current: '400.2' },
        }));

        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch }))
            .resolves.toBe('600.05');
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0]).toBe(`${explorerUrl}/${coin}/api/token/XCHAIN`);
        expect(fetch.mock.calls[0][0]).not.toContain('localhost:18080');
    });

    it('returns null when the gas token is absent', async () => {
        const fetch = vi.fn(async () => reply(404));
        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch })).resolves.toBeNull();
    });

    it('returns null for non-JSON and incomplete token records', async () => {
        const nonJson = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: vi.fn(async () => { throw new SyntaxError('not JSON'); }),
        }));
        const missingSupply = vi.fn(async () => reply(200, { supply: { max: '1000' } }));

        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch: nonJson }))
            .resolves.toBeNull();
        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch: missingSupply }))
            .resolves.toBeNull();
    });

    it('reports a fetch rejection by code without echoing its message', async () => {
        const rejection = Object.assign(new Error('secret-bearing transport detail'), {
            code: 'ECONNRESET',
        });
        const fetch = vi.fn(async () => { throw rejection; });

        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch }))
            .rejects.toThrow('Gas headroom read failed: ECONNRESET');
        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch }))
            .rejects.not.toThrow('secret-bearing transport detail');
    });

    it('reports a non-404 HTTP failure by status', async () => {
        const fetch = vi.fn(async () => reply(500));
        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch }))
            .rejects.toThrow('Gas headroom read failed: HTTP 500');
    });

    it('refuses insufficient headroom before touching the page', async () => {
        const fetch = vi.fn(async () => reply(200, {
            supply: { max: '10', current: '8.5' },
        }));
        const page = new Proxy({}, {
            get() {
                throw new Error('page method reached');
            },
        });

        await expect(mintTestnetXchain(page, '2', { explorerUrl, coin, fetch }))
            .rejects.toThrow('XCHAIN mint headroom 1.5 is below requested amount 2');
    });
});
