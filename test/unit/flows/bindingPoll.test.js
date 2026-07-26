// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// PC-42: binding-poll pre-flight validation.
//
// The rule worth pinning is the turnout floor: the wallet demands QUORUM and
// MIN_VOTERS on EVERY binding poll, including before the VOTE_BINDING_MINIMUMS
// flag-day when the chain would still accept one without them. A poll is
// permanent, so the stricter side is the safe side.

import { describe, it, expect } from 'vitest';
import { isBindingPoll, bindingPollErrors } from '../../../packages/core/src/flows/bindingPoll.js';

const VALID = {
    callbackContract: '2705',
    callbackMethod: 'ping',
    callbackOn: 'pass',
    quorum: '0.2',
    minVoters: '3',
};

describe('isBindingPoll', () => {
    it('is binding only once a callback contract is named', () => {
        expect(isBindingPoll({ callbackContract: '42' })).toBe(true);
        expect(isBindingPoll({ callbackContract: '' })).toBe(false);
        expect(isBindingPoll({ callbackContract: '   ' })).toBe(false);
        expect(isBindingPoll({})).toBe(false);
        expect(isBindingPoll(null)).toBe(false);
    });
});

describe('bindingPollErrors', () => {
    it('passes a well-formed binding poll', () => {
        expect(bindingPollErrors(VALID)).toEqual([]);
    });

    it('checks nothing on an advisory poll, however malformed the other fields', () => {
        expect(bindingPollErrors({
            callbackContract: '', callbackMethod: '', callbackParams: 'not json',
            gasEscrow: '-5', quorum: '', minVoters: '',
        })).toEqual([]);
    });

    it('requires a quorum on a binding poll even though the chain does not yet', () => {
        const errs = bindingPollErrors({ ...VALID, quorum: '' });
        expect(errs.some((e) => /quorum/i.test(e))).toBe(true);
    });

    it('requires at least one voter, and rejects a zero floor', () => {
        expect(bindingPollErrors({ ...VALID, minVoters: '' }).some((e) => /minimum number of voters/i.test(e))).toBe(true);
        expect(bindingPollErrors({ ...VALID, minVoters: '0' }).some((e) => /at least 1/i.test(e))).toBe(true);
    });

    it('rejects a quorum outside the 0 < q <= 1 share range', () => {
        for (const q of ['0', '-0.1', '1.5', 'half']) {
            expect(bindingPollErrors({ ...VALID, quorum: q }).length).toBeGreaterThan(0);
        }
        expect(bindingPollErrors({ ...VALID, quorum: '1' })).toEqual([]);
    });

    it('requires a method name, bounded to the indexer cap', () => {
        expect(bindingPollErrors({ ...VALID, callbackMethod: '' }).some((e) => /method/i.test(e))).toBe(true);
        expect(bindingPollErrors({ ...VALID, callbackMethod: 'x'.repeat(64) })).toEqual([]);
        expect(bindingPollErrors({ ...VALID, callbackMethod: 'x'.repeat(65) }).some((e) => /too long/i.test(e))).toBe(true);
    });

    it('requires the contract to be a contract number, not an address or name', () => {
        expect(bindingPollErrors({ ...VALID, callbackContract: 'bcrt1qxyz' }).some((e) => /contract number/i.test(e))).toBe(true);
        expect(bindingPollErrors({ ...VALID, callbackContract: '12.5' }).some((e) => /contract number/i.test(e))).toBe(true);
    });

    it('rejects extra arguments that are not a JSON list', () => {
        expect(bindingPollErrors({ ...VALID, callbackParams: '{"a":1}' }).some((e) => /JSON list/i.test(e))).toBe(true);
        expect(bindingPollErrors({ ...VALID, callbackParams: 'treasury' }).some((e) => /JSON list/i.test(e))).toBe(true);
        expect(bindingPollErrors({ ...VALID, callbackParams: '["treasury", 1000]' })).toEqual([]);
    });

    it('rejects an invalid fire-on choice', () => {
        expect(bindingPollErrors({ ...VALID, callbackOn: 'maybe' }).length).toBeGreaterThan(0);
        expect(bindingPollErrors({ ...VALID, callbackOn: 'always' })).toEqual([]);
    });

    it('rejects a negative escrow but accepts zero', () => {
        expect(bindingPollErrors({ ...VALID, gasEscrow: '-1' }).length).toBeGreaterThan(0);
        expect(bindingPollErrors({ ...VALID, gasEscrow: '0' })).toEqual([]);
    });

    it('rejects a fractional or negative callback delay', () => {
        expect(bindingPollErrors({ ...VALID, callbackDelayBlocks: '1.5' }).length).toBeGreaterThan(0);
        expect(bindingPollErrors({ ...VALID, callbackDelayBlocks: '-1' }).length).toBeGreaterThan(0);
        expect(bindingPollErrors({ ...VALID, callbackDelayBlocks: '0' })).toEqual([]);
        expect(bindingPollErrors({ ...VALID, callbackDelayBlocks: '144' })).toEqual([]);
    });

    it('reports every problem at once so the user fixes them in one pass', () => {
        const errs = bindingPollErrors({ callbackContract: 'nope', callbackMethod: '', quorum: '', minVoters: '' });
        expect(errs.length).toBe(4);
    });
});
