// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The balance an irreversible action is judged against: an unknown balance is
// never zero, and the Approve-time re-read gives up instead of holding Approve
// while the explorer client retries a dead connection.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    readSourceTickBalance,
    recheckSourceTickBalance,
    RECHECK_TIMEOUT_MS,
} from '../../../packages/core/src/flows/sourceTickBalance.js';

const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qsource';
const read = (answer) => ({
    messaging: { getWalletBalances: vi.fn(() => (typeof answer === 'function' ? answer() : Promise.resolve(answer))) },
    walletId: 'w', chainId: CHAIN, address: ADDRESS, tick: 'art',
});
const entry = (balances, error = null) => ({ [CHAIN]: [{ address: ADDRESS, balances, error }] });

afterEach(() => { vi.useRealTimers(); });

describe('readSourceTickBalance', () => {
    it('reads the token at coin scale', async () => {
        const r = await readSourceTickBalance(read(entry({ tokens: [{ tick: 'ART', quantity: '250000000', divisibility: 8 }] })));
        expect(r).toEqual({ ok: true, amount: '2.5' });
    });

    it('reads zero for a token the address does not hold', async () => {
        const r = await readSourceTickBalance(read(entry({ tokens: [{ tick: 'GLD', quantity: '5', divisibility: 0 }] })));
        expect(r).toEqual({ ok: true, amount: '0' });
    });

    it.each([
        ['a failed read', entry(null, 'explorer unreachable')],
        ['an unavailable token half', entry({ tokens: [], unavailable: ['tokens'], unavailableReason: 'x' })],
        ['an unparseable quantity', entry({ tokens: [{ tick: 'ART', quantity: '1e3', divisibility: 0 }] })],
        ['a missing address', { [CHAIN]: [] }],
    ])('treats %s as unread', async (_name, answer) => {
        expect(await readSourceTickBalance(read(answer))).toEqual({ ok: false });
    });

    it('treats a rejected read as unread', async () => {
        expect(await readSourceTickBalance(read(() => Promise.reject(new Error('down'))))).toEqual({ ok: false });
    });
});

describe('recheckSourceTickBalance', () => {
    it('refuses an amount above the fresh balance', async () => {
        const deps = read(entry({ tokens: [{ tick: 'ART', quantity: '4', divisibility: 0 }] }));
        const r = await recheckSourceTickBalance({ ...deps, amount: '5' });
        expect(r).toEqual({ ok: false, reason: 'short', balance: '4' });
        expect(deps.messaging.getWalletBalances).toHaveBeenCalledWith(
            'w', undefined, CHAIN, { fresh: true },
        );
    });

    it('accepts the full balance', async () => {
        const r = await recheckSourceTickBalance({ ...read(entry({ tokens: [{ tick: 'ART', quantity: '5', divisibility: 0 }] })), amount: '5' });
        expect(r).toEqual({ ok: true, balance: '5' });
    });

    it('gives up as unread when the read does not answer in time', async () => {
        vi.useFakeTimers();
        const pending = recheckSourceTickBalance({ ...read(() => new Promise(() => {})), amount: '1' });
        await vi.advanceTimersByTimeAsync(RECHECK_TIMEOUT_MS);
        expect(await pending).toEqual({ ok: false, reason: 'unread' });
        expect(RECHECK_TIMEOUT_MS).toBeLessThanOrEqual(15000);
    });
});
