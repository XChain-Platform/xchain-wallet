// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import { decodeAction } from '../../packages/core/src/decoder/actionDecoder.js';
import { defaultRegistry } from '../../packages/core/src/registry/index.js';

describe('decodeAction', () => {
    const chainRegistry = defaultRegistry();

    describe('SEND', () => {
        it('produces a human summary with chain name', () => {
            const d = decodeAction({
                action: 'SEND',
                params: {
                    TICK: 'MYTOKEN',
                    AMOUNT: '100',
                    DESTINATION: 'bc1qtest',
                },
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            expect(d.summary).toBe('Send 100 MYTOKEN on Bitcoin to bc1qtest');
        });

        it('omits the chain phrase when no registry is passed', () => {
            const d = decodeAction({
                action: 'SEND',
                params: { TICK: 'BTC', AMOUNT: '1', DESTINATION: 'bc1qx' },
            });
            expect(d.summary).toBe('Send 1 BTC to bc1qx');
        });

        it('places the memo in the details list only when non-empty', () => {
            const withMemo = decodeAction({
                action: 'SEND',
                params: { TICK: 'BTC', AMOUNT: '1', DESTINATION: 'x', MEMO: 'hi' },
            });
            expect(withMemo.details.find((r) => r.label === 'Memo'))
                .toEqual({ label: 'Memo', value: 'hi' });

            const withoutMemo = decodeAction({
                action: 'SEND',
                params: { TICK: 'BTC', AMOUNT: '1', DESTINATION: 'x' },
            });
            expect(withoutMemo.details.find((r) => r.label === 'Memo')).toBeUndefined();
        });

        it.each([
            ['hi|there', /\|/],
            ['hi;there', /\|/], // both chars share the same warning pattern
        ])('warns when memo contains a forbidden char (%s)', (memo, _pattern) => {
            const d = decodeAction({
                action: 'SEND',
                params: { TICK: 'BTC', AMOUNT: '1', DESTINATION: 'x', MEMO: memo },
            });
            expect(d.warnings.some((w) => /memo contains/i.test(w))).toBe(true);
        });

        it('warns on non-positive amount + empty destination', () => {
            const d = decodeAction({
                action: 'SEND',
                params: { TICK: 'BTC', AMOUNT: '0', DESTINATION: '' },
            });
            expect(d.warnings.some((w) => /positive/i.test(w))).toBe(true);
            expect(d.warnings.some((w) => /destination is empty/i.test(w))).toBe(true);
        });
    });

    describe('SWEEP', () => {
        it('summarises the swept categories and attaches the warning', () => {
            const d = decodeAction({
                action: 'SWEEP',
                params: { DESTINATION: 'bc1qrecip' },
                chainId: 'dogecoin-mainnet',
                chainRegistry,
            });
            // No flags given → BALANCES/OWNERSHIPS default on, escrow flags off.
            expect(d.summary).toBe('Sweep balances, ownerships on Dogecoin to bc1qrecip');
            expect(d.warnings.some((w) => /sweep moves the selected/i.test(w))).toBe(true);
        });

        it('reflects the selective flags + memo rows', () => {
            const d = decodeAction({
                action: 'SWEEP',
                params: { DESTINATION: 'x', BALANCES: '1', OWNERSHIPS: '0', ORDERS: '1', MEMO: 'cleanup' },
            });
            expect(d.details.map((r) => r.label)).toEqual(['Destination', 'Sweeps', 'Memo']);
            const sweeps = d.details.find((r) => r.label === 'Sweeps');
            expect(sweeps.value).toBe('balances, open orders');
        });
    });

    describe('fallback', () => {
        it('surfaces the "no plain-English" warning for unknown kinds', () => {
            // Use a synthetic action name guaranteed to miss every
            // friendly decoder so the fallback summary + warning render.
            // ISSUE used to fit here, but it now gets a friendly
            // "Configure token …" summary from the decoder.
            const d = decodeAction({
                action: 'NOT_A_REAL_ACTION',
                params: { foo: 'bar' },
                chainId: 'bitcoin-mainnet',
                chainRegistry,
            });
            expect(d.summary).toMatch(/^Sign NOT_A_REAL_ACTION on Bitcoin$/);
            expect(d.warnings[0]).toMatch(/no plain-english summary/i);
        });

        it('pretty-prints non-string param values', () => {
            const d = decodeAction({
                action: 'UNKNOWN',
                params: { FLAG: true, NESTED: { foo: 'bar' } },
            });
            const nested = d.details.find((r) => r.label === 'NESTED');
            expect(nested?.value).toBe('{"foo":"bar"}');
        });
    });

    describe('guards', () => {
        it('returns a well-formed result for missing action + params', () => {
            const d = decodeAction({});
            expect(typeof d.summary).toBe('string');
            expect(Array.isArray(d.details)).toBe(true);
            expect(Array.isArray(d.warnings)).toBe(true);
        });
    });
});
