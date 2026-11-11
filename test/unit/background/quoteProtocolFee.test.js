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
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const ACTION_DATA = { action: 'VOTE', params: { PROPOSAL: 7, CHOICE: 1 } };

function hostFor(sdk) {
    return createBackgroundHost({
        vault: {},
        chainRegistry: {},
        sdkRegistry: { get: vi.fn(() => sdk) },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
}

function request(overrides = {}) {
    return {
        type: 'action.quoteProtocolFee',
        request: {
            chainId: 'bitcoin-regtest',
            source: 'bcrt1qsource',
            actionData: ACTION_DATA,
            ...overrides,
        },
    };
}

describe('action.quoteProtocolFee', () => {
    it('quotes the draft action through the SDK and returns its answer', async () => {
        const answer = { supported: true, valid: true, xchainFee: '0.01', requiredFeeSats: 1000 };
        const quoteNativeFee = vi.fn(async () => answer);

        const response = await hostFor({ quoteNativeFee }).handle(request());

        expect(response).toEqual({ ok: true, result: answer });
        expect(quoteNativeFee).toHaveBeenCalledOnce();
        expect(quoteNativeFee).toHaveBeenCalledWith(
            { action: 'VOTE', params: { PROPOSAL: 7, CHOICE: 1 } },
            { source: 'bcrt1qsource' },
        );
    });

    it('keeps the display quote outside the Approve-time fresh scope', async () => {
        const explorer = {};
        const scopes = [];
        const quoteNativeFee = vi.fn(async () => {
            scopes.push(Reflect.ownKeys(explorer).some((key) => (
                typeof key === 'symbol'
                && key.description === 'xc.freshScope'
                && explorer[key] > 0
            )));
            return { supported: true, valid: true };
        });
        const host = hostFor({ explorer, quoteNativeFee });

        await host.handle(request());
        await host.handle({
            type: 'action.requoteNativeFee',
            request: {
                chainId: 'bitcoin-regtest',
                source: 'bcrt1qsource',
                actionString: 'VOTE|7|1',
            },
        });

        expect(scopes).toEqual([false, true]);
    });

    it.each([
        [{ chainId: '' }, /chainId is required/],
        [{ actionData: { params: {} } }, /actionData\.action is required/],
        [{ actionData: { action: 'VOTE' } }, /actionData\.params is required/],
    ])('rejects an invalid request before quoting', async (overrides, expected) => {
        const quoteNativeFee = vi.fn();

        const response = await hostFor({ quoteNativeFee }).handle(request(overrides));

        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(expected);
        expect(quoteNativeFee).not.toHaveBeenCalled();
    });

    it('returns null when the SDK quote fails', async () => {
        const quoteNativeFee = vi.fn(async () => { throw new Error('explorer offline'); });

        const response = await hostFor({ quoteNativeFee }).handle(request());

        expect(response).toEqual({ ok: true, result: null });
        expect(quoteNativeFee).toHaveBeenCalledOnce();
    });

    it('returns null when the SDK cannot quote native fees', async () => {
        const response = await hostFor({}).handle(request());

        expect(response).toEqual({ ok: true, result: null });
    });
});
