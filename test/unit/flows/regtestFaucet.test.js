// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import { fundBtcFromMiner } from '../../../packages/core/src/flows/regtestFaucet.js';

const validRequest = (overrides = {}) => ({
    minerUrl: 'http://localhost:3005',
    address: 'bcrt1qexample',
    amount: 1.25,
    fetch: vi.fn(async () => ({ ok: true, json: async () => ({ result: 'txid-123' }) })),
    ...overrides,
});

describe('fundBtcFromMiner', () => {
    it.each([
        [undefined, 'Miner URL is required'],
        [42, 'Miner URL is required'],
    ])('rejects invalid miner URLs without fetching', async (minerUrl, error) => {
        const fetch = vi.fn();
        const result = await fundBtcFromMiner(validRequest({ minerUrl, fetch }));

        expect(result).toEqual({ ok: false, error });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects a missing address without fetching', async () => {
        const fetch = vi.fn();
        const result = await fundBtcFromMiner(validRequest({ address: undefined, fetch }));

        expect(result).toEqual({ ok: false, error: 'Address is required' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([0, -1, 'abc'])('rejects invalid amount %j without fetching', async (amount) => {
        const fetch = vi.fn();
        const result = await fundBtcFromMiner(validRequest({ amount, fetch }));

        expect(result).toEqual({ ok: false, error: 'Amount must be a positive number' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('posts the numeric amount to the normalized miner URL with an API key', async () => {
        const request = validRequest({ minerUrl: 'http://miner.test////', amount: '2.5', apiKey: 'secret' });
        const result = await fundBtcFromMiner(request);

        expect(result).toEqual({ ok: true, txid: 'txid-123' });
        expect(request.fetch).toHaveBeenCalledWith('http://miner.test/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': 'secret' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'send_funds',
                params: { address: 'bcrt1qexample', amount: 2.5 },
            }),
        });
    });

    it('omits the API key header when none is given', async () => {
        const request = validRequest();
        await fundBtcFromMiner(request);

        expect(request.fetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('reports a fetch failure with the miner URL', async () => {
        const fetch = vi.fn(async () => { throw new Error('connection refused'); });
        const result = await fundBtcFromMiner(validRequest({ fetch }));

        expect(result).toEqual({
            ok: false,
            error: 'Could not reach the regtest miner at http://localhost:3005: connection refused',
        });
    });

    it('reports a non-successful HTTP status', async () => {
        const fetch = vi.fn(async () => ({ ok: false, status: 503 }));
        const result = await fundBtcFromMiner(validRequest({ fetch }));

        expect(result).toEqual({ ok: false, error: 'Miner returned HTTP 503' });
    });

    it('reports a response body that cannot be parsed as JSON', async () => {
        const fetch = vi.fn(async () => ({
            ok: true,
            json: async () => { throw new Error('unexpected token'); },
        }));
        const result = await fundBtcFromMiner(validRequest({ fetch }));

        expect(result).toEqual({
            ok: false,
            error: 'Miner returned a non-JSON response: unexpected token',
        });
    });

    it.each([
        [{ error: 'wallet unavailable' }, 'wallet unavailable'],
        [{ error: { message: 'insufficient funds' } }, 'insufficient funds'],
        [{ result: { error: 'transaction rejected' } }, 'transaction rejected'],
    ])('returns a miner error from response body %#', async (body, error) => {
        const fetch = vi.fn(async () => ({ ok: true, json: async () => body }));
        const result = await fundBtcFromMiner(validRequest({ fetch }));

        expect(result).toEqual({ ok: false, error });
    });

    it.each([
        {},
        { result: '' },
        { result: 123 },
    ])('rejects a missing, empty, or non-string transaction id %#', async (body) => {
        const fetch = vi.fn(async () => ({ ok: true, json: async () => body }));
        const result = await fundBtcFromMiner(validRequest({ fetch }));

        expect(result).toEqual({ ok: false, error: 'Miner did not return a transaction id' });
    });
});
