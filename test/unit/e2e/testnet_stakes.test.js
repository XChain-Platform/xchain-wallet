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
import { waitForResidualStake } from '../../e2e/fixtures/testnet_stakes.js';

const ADDRESS = 'stake-source-address';
const ACTION_INDEX = 17;
const OPTIONS = Object.freeze({
    explorerUrl: 'https://explorer.invalid',
    coin: 'COIN',
    timeoutMs: 100,
    pollMs: 10,
});

function response(body, { ok = true, status = 200 } = {}) {
    return { ok, status, json: vi.fn(async () => body) };
}

function clock() {
    let time = 0;
    const sleep = vi.fn(async (ms) => {
        time += ms;
    });
    return { now: () => time, sleep };
}

describe('testnet residual stake polling', () => {
    it('returns a matching row from the third poll after two empty answers', async () => {
        const row = { action_index: String(ACTION_INDEX), amount: '70' };
        const fetch = vi.fn()
            .mockResolvedValueOnce(response([]))
            .mockResolvedValueOnce(response([]))
            .mockResolvedValueOnce(response([row]));
        const time = clock();

        await expect(waitForResidualStake(ADDRESS, ACTION_INDEX, {
            ...OPTIONS,
            ...time,
            fetch,
        })).resolves.toBe(row);
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(fetch).toHaveBeenCalledWith(
            `${OPTIONS.explorerUrl}/${OPTIONS.coin}/api/stakes/${ADDRESS}/source`,
            { signal: expect.any(AbortSignal) },
        );
    });

    it.each([
        ['data', (rows) => ({ data: rows })],
        ['rows', (rows) => ({ rows })],
    ])('reads a matching row from the %s body shape', async (_label, wrap) => {
        const row = { action_index: ACTION_INDEX };
        const fetch = vi.fn(async () => response(wrap([row])));

        await expect(waitForResidualStake(ADDRESS, ACTION_INDEX, {
            ...OPTIONS,
            ...clock(),
            fetch,
        })).resolves.toBe(row);
    });

    it('ignores a row with another action index', async () => {
        const fetch = vi.fn(async () => response([{ action_index: ACTION_INDEX + 1 }]));

        await expect(waitForResidualStake(ADDRESS, ACTION_INDEX, {
            ...OPTIONS,
            ...clock(),
            fetch,
        })).rejects.toThrow(`residual stake for action ${ACTION_INDEX} was not indexed`);
    });

    it('names the HTTP status when the last poll returns 404', async () => {
        const fetch = vi.fn(async () => response([], { ok: false, status: 404 }));

        await expect(waitForResidualStake(ADDRESS, ACTION_INDEX, {
            ...OPTIONS,
            ...clock(),
            fetch,
        })).rejects.toThrow(`action ${ACTION_INDEX} was not indexed; last explorer failure: HTTP 404`);
        expect(fetch).toHaveBeenCalledTimes(10);
    });

    it('names the error code when the last fetch rejects', async () => {
        const refusal = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
        const fetch = vi.fn(async () => {
            throw refusal;
        });

        await expect(waitForResidualStake(ADDRESS, ACTION_INDEX, {
            ...OPTIONS,
            ...clock(),
            fetch,
        })).rejects.toThrow(
            `action ${ACTION_INDEX} was not indexed; last explorer failure: ECONNREFUSED`,
        );
        expect(fetch).toHaveBeenCalledTimes(10);
    });

    it.each([
        ['an object without a stake list', { total: 0 }],
        ['a null body', null],
    ])('names NO_STAKE_LIST when the last poll returns %s', async (_label, body) => {
        const fetch = vi.fn(async () => response(body));

        await expect(waitForResidualStake(ADDRESS, ACTION_INDEX, {
            ...OPTIONS,
            ...clock(),
            fetch,
        })).rejects.toThrow(
            `action ${ACTION_INDEX} was not indexed; last explorer failure: NO_STAKE_LIST`,
        );
        expect(fetch).toHaveBeenCalledTimes(10);
    });

    it('recovers when a no-list answer is followed by a matching row', async () => {
        const row = { action_index: ACTION_INDEX };
        const fetch = vi.fn()
            .mockResolvedValueOnce(response({ total: 0 }))
            .mockResolvedValueOnce(response([row]));

        await expect(waitForResidualStake(ADDRESS, ACTION_INDEX, {
            ...OPTIONS,
            ...clock(),
            fetch,
        })).resolves.toBe(row);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['https://explorer.private.example/stakes', 'explorer.private.example'],
        ['request to internal-service failed', 'internal-service'],
        ['address tb1qsecretwalletaddress was rejected', 'tb1qsecretwalletaddress'],
        ['wallet key xprv9sensitiveprivatekey was rejected', 'xprv9sensitiveprivatekey'],
    ])('does not expose rejection message data from %s', async (message, secret) => {
        const fetch = vi.fn(async () => {
            throw Object.assign(new Error(message), { code: 'EHOSTUNREACH' });
        });
        let error;

        try {
            await waitForResidualStake(ADDRESS, ACTION_INDEX, {
                ...OPTIONS,
                ...clock(),
                fetch,
            });
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('last explorer failure: EHOSTUNREACH');
        expect(error.message).not.toContain(secret);
    });

    it('uses a cause code when the rejection has no direct code', async () => {
        const fetch = vi.fn(async () => {
            throw new Error('request to internal-service failed', {
                cause: { code: 'ENETUNREACH' },
            });
        });

        await expect(waitForResidualStake(ADDRESS, ACTION_INDEX, {
            ...OPTIONS,
            ...clock(),
            fetch,
        })).rejects.toThrow('last explorer failure: ENETUNREACH');
    });

    it('reports an AbortSignal timeout rejection by its name', async () => {
        const fetch = vi.fn(async () => {
            const signal = AbortSignal.timeout(0);
            await new Promise((resolve) => {
                signal.addEventListener('abort', resolve, { once: true });
            });
            throw signal.reason;
        });

        await expect(waitForResidualStake(ADDRESS, ACTION_INDEX, {
            ...OPTIONS,
            ...clock(),
            fetch,
        })).rejects.toThrow('last explorer failure: TimeoutError');
    });

    it('reports a code outside the safe pattern as unknown', async () => {
        const fetch = vi.fn(async () => {
            throw Object.assign(new Error('request failed'), { code: 'unsafe-code: host' });
        });

        await expect(waitForResidualStake(ADDRESS, ACTION_INDEX, {
            ...OPTIONS,
            ...clock(),
            fetch,
        })).rejects.toThrow('last explorer failure: unknown');
    });

    it('reports only that the residual was not indexed after empty answers', async () => {
        const fetch = vi.fn(async () => response([]));
        let error;

        try {
            await waitForResidualStake(ADDRESS, ACTION_INDEX, {
                ...OPTIONS,
                ...clock(),
                fetch,
            });
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe(`residual stake for action ${ACTION_INDEX} was not indexed`);
    });

    it('sleeps for the configured poll interval', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(response([]))
            .mockResolvedValueOnce(response([{ action_index: ACTION_INDEX }]));
        const time = clock();

        await waitForResidualStake(ADDRESS, ACTION_INDEX, {
            ...OPTIONS,
            ...time,
            fetch,
        });

        expect(time.sleep).toHaveBeenCalledWith(OPTIONS.pollMs);
    });
});
