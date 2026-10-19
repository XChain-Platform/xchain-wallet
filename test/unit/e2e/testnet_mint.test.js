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

    it('returns null for an incomplete token record', async () => {
        const missingSupply = vi.fn(async () => reply(200, { supply: { max: '1000' } }));

        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch: missingSupply }))
            .resolves.toBeNull();
    });

    it.each([
        ['an unparsable body', async () => { throw new SyntaxError('secret parse detail'); }],
        ['a null body', async () => null],
        ['an array body', async () => []],
    ])('reports %s as not JSON without exposing parse detail', async (_label, json) => {
        const fetch = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: vi.fn(json),
        }));

        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch }))
            .rejects.toThrow('Gas headroom read failed: not JSON');
        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch }))
            .rejects.not.toThrow('secret parse detail');
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

    it('reports an AbortSignal timeout rejection by its DOMException name', async () => {
        const rejection = new DOMException('The operation timed out', 'TimeoutError');
        const fetch = vi.fn(async () => { throw rejection; });

        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch }))
            .rejects.toThrow('Gas headroom read failed: TimeoutError');
    });

    it('reports a cause code when the rejection has no own code', async () => {
        const rejection = new Error('transport failed', {
            cause: { code: 'CAUSE_ONLY' },
        });
        const fetch = vi.fn(async () => { throw rejection; });

        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch }))
            .rejects.toThrow('Gas headroom read failed: CAUSE_ONLY');
    });

    it('prefers a cause code over a different own code', async () => {
        const rejection = Object.assign(new Error('transport failed', {
            cause: { code: 'CAUSE_CODE' },
        }), { code: 'OWN_CODE' });
        const fetch = vi.fn(async () => { throw rejection; });

        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch }))
            .rejects.toThrow('Gas headroom read failed: CAUSE_CODE');
    });

    it.each(['BAD.CODE', 'CODE1'])('reports an invalid rejection code %s as unknown', async (code) => {
        const rejection = Object.assign(Object.create(null), { code });
        const fetch = vi.fn(async () => { throw rejection; });

        await expect(readTestnetGasHeadroom({ explorerUrl, coin, fetch }))
            .rejects.toThrow('Gas headroom read failed: unknown');
    });

    it.each([
        'request to https://wallet-secrets.example failed',
        'lookup internal-service failed',
        'address tb1qsecretaddress leaked',
        'key xprv9s21ZrQH143K leaked',
    ])('does not expose rejection message detail: %s', async (message) => {
        const rejection = new Error(message, { cause: new Error(`cause: ${message}`) });
        const fetch = vi.fn(async () => { throw rejection; });

        let thrown;
        try {
            await readTestnetGasHeadroom({ explorerUrl, coin, fetch });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.message).toBe('Gas headroom read failed: Error');
        expect(thrown.message).not.toContain(message);
        expect(thrown.message).not.toContain(`cause: ${message}`);
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
