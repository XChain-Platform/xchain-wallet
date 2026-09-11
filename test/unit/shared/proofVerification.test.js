// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: §7/§8 verification reducers. The hook wiring is exercised by the
// route-render guard; here we test the two pure pieces directly: which
// (address, tick) pairs become jobs (native is never one), and how the
// per-address verdicts reduce to a single per-row verdict.

import { describe, it, expect } from 'vitest';
import {
    collectBalanceJobs,
    proofJobsSignature,
    reduceBalanceTrust,
    reduceBalanceVerdict,
} from '../../../packages/core/src/shared/hooks/useProofVerification.js';

describe('collectBalanceJobs', () => {
    it('emits one job per (chainId, address, token tick) and skips the native coin', () => {
        const balances = {
            'bitcoin-regtest': [
                { address: 'addrA', balances: { native: { tick: 'BTC' }, tokens: [{ tick: 'FOO' }, { tick: 'BAR' }] } },
                { address: 'addrB', balances: { tokens: [{ tick: 'FOO' }] } },
            ],
        };
        const jobs = collectBalanceJobs(balances);
        // 3 token jobs (addrA:FOO, addrA:BAR, addrB:FOO); the native BTC is excluded.
        expect(jobs).toHaveLength(3);
        expect(jobs.every((j) => j.tick !== 'BTC')).toBe(true);
        const keys = jobs.map((j) => `${j.address}:${j.tick}`);
        expect(keys).toEqual(expect.arrayContaining(['addrA:FOO', 'addrA:BAR', 'addrB:FOO']));
        // Row key collapses across addresses (both FOO jobs share one key).
        expect(jobs.filter((j) => j.key === 'bitcoin-regtest:FOO')).toHaveLength(2);
    });

    it('tolerates malformed input (null, missing tokens, non-array entries)', () => {
        expect(collectBalanceJobs(null)).toEqual([]);
        expect(collectBalanceJobs({ 'x': 'nope' })).toEqual([]);
        expect(collectBalanceJobs({ 'x': [{ address: 'a', balances: {} }] })).toEqual([]);
        expect(collectBalanceJobs({ 'x': [{ address: 'a', balances: { tokens: [{}] } }] })).toEqual([]);
    });
});

describe('reduceBalanceVerdict', () => {
    it('is verified only when every contributing address verified', () => {
        expect(reduceBalanceVerdict({ total: 2, done: 2, failed: 0, verified: 2 })).toBe('verified');
    });

    it('is failed if ANY address failed, even before all are done', () => {
        expect(reduceBalanceVerdict({ total: 3, done: 1, failed: 1, verified: 0 })).toBe('failed');
    });

    it('is pending while proofs are still outstanding (and none failed)', () => {
        expect(reduceBalanceVerdict({ total: 2, done: 1, failed: 0, verified: 1 })).toBe('pending');
    });

    it('is unavailable when all are done but not all verified', () => {
        expect(reduceBalanceVerdict({ total: 2, done: 2, failed: 0, verified: 1 })).toBe('unavailable');
    });
});

describe('proofJobsSignature', () => {
    it('is the same string for an equal job set under a new object identity', () => {
        const a = { 'bitcoin-regtest': [{ address: 'addrA', balances: { tokens: [{ tick: 'FOO' }] } }] };
        const b = { 'bitcoin-regtest': [{ address: 'addrA', balances: { tokens: [{ tick: 'FOO' }] } }] };
        expect(a).not.toBe(b);
        expect(proofJobsSignature(a)).toBe(proofJobsSignature(b));
    });

    it('is the same string regardless of the order the jobs are found in', () => {
        const forward = {
            'bitcoin-regtest': [{ address: 'addrA', balances: { tokens: [{ tick: 'FOO' }, { tick: 'BAR' }] } }],
            'litecoin-regtest': [{ address: 'addrB', balances: { tokens: [{ tick: 'BAZ' }] } }],
        };
        const reversed = {
            'litecoin-regtest': [{ address: 'addrB', balances: { tokens: [{ tick: 'BAZ' }] } }],
            'bitcoin-regtest': [{ address: 'addrA', balances: { tokens: [{ tick: 'BAR' }, { tick: 'FOO' }] } }],
        };
        expect(proofJobsSignature(forward)).toBe(proofJobsSignature(reversed));
    });

    it('changes when a token arrives', () => {
        const before = { 'bitcoin-regtest': [{ address: 'addrA', balances: { tokens: [{ tick: 'FOO' }] } }] };
        const after = { 'bitcoin-regtest': [{ address: 'addrA', balances: { tokens: [{ tick: 'FOO' }, { tick: 'BAR' }] } }] };
        expect(proofJobsSignature(before)).not.toBe(proofJobsSignature(after));
    });

    it('changes when an address is removed', () => {
        const before = {
            'bitcoin-regtest': [
                { address: 'addrA', balances: { tokens: [{ tick: 'FOO' }] } },
                { address: 'addrB', balances: { tokens: [{ tick: 'FOO' }] } },
            ],
        };
        const after = {
            'bitcoin-regtest': [{ address: 'addrA', balances: { tokens: [{ tick: 'FOO' }] } }],
        };
        expect(proofJobsSignature(before)).not.toBe(proofJobsSignature(after));
    });

    it('excludes native coins, so a native-only balances shape signs the same as no jobs', () => {
        const nativeOnly = {
            'bitcoin-regtest': [{ address: 'addrA', balances: { native: { tick: 'BTC' } } }],
        };
        expect(proofJobsSignature(nativeOnly)).toBe('');
    });

    it('is the empty string for null (and other job-free input)', () => {
        expect(proofJobsSignature(null)).toBe('');
        expect(proofJobsSignature({})).toBe('');
    });
});

describe('reduceBalanceTrust', () => {
    it('claims the pinned root only when every settled address used one', () => {
        expect(reduceBalanceTrust({ done: 2, pinned: 2 })).toBe('pinned');
    });

    it('drops to the explorer tier if a single address fell through to it', () => {
        expect(reduceBalanceTrust({ done: 2, pinned: 1 })).toBe('explorer');
    });

    it('is the explorer tier before anything has settled (never claim a root you have not used)', () => {
        expect(reduceBalanceTrust({ done: 0, pinned: 0 })).toBe('explorer');
    });
});
