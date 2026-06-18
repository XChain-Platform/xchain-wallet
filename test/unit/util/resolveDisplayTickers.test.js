// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import { resolveDisplayTickers } from '../../../packages/core/src/shared/utils/resolveDisplayTickers.js';

// Maps ^id -> name; returns null for anything unknown (mirrors a failed lookup).
function lookupFrom(map) {
    return async (ref) => map[ref] ?? null;
}

describe('resolveDisplayTickers', () => {
    const names = lookupFrom({ '^11': 'TOKENA', '^22': 'TOKENB' });

    it('resolves a ^id TICK to its name', async () => {
        const out = await resolveDisplayTickers('SEND', { TICK: '^11', AMOUNT: '1' }, names);
        expect(out.TICK).to.equal('TOKENA');
        expect(out.AMOUNT).to.equal('1');
    });

    it('keeps the ^id when the name cannot be resolved', async () => {
        const out = await resolveDisplayTickers('SEND', { TICK: '^99' }, names);
        expect(out.TICK).to.equal('^99');
    });

    it('leaves a plain ticker name untouched and never calls lookup', async () => {
        let called = false;
        const spy = async (ref) => { called = true; return 'X'; };
        const params = { TICK: 'JDOG', AMOUNT: '1' };
        const out = await resolveDisplayTickers('SEND', params, spy);
        expect(out).to.equal(params); // same reference, nothing changed
        expect(called).to.equal(false);
    });

    it('does NOT resolve the defining TICK of an ISSUE', async () => {
        const out = await resolveDisplayTickers('ISSUE', { TICK: '^11' }, names);
        expect(out.TICK).to.equal('^11');
    });

    it('resolves multiple ticker fields (DIVIDEND TICK + DIVIDEND_TICK)', async () => {
        const out = await resolveDisplayTickers('DIVIDEND', { TICK: '^11', DIVIDEND_TICK: '^22', AMOUNT: '1' }, names);
        expect(out.TICK).to.equal('TOKENA');
        expect(out.DIVIDEND_TICK).to.equal('TOKENB');
    });

    it('resolves ^id entries inside an array field', async () => {
        const out = await resolveDisplayTickers('AIRDROP', { TICK: ['^11', 'PLAIN', '^22'] }, names);
        expect(out.TICK).to.deep.equal(['TOKENA', 'PLAIN', 'TOKENB']);
    });

    it('returns the same params reference when there is nothing to resolve', async () => {
        const params = { AMOUNT: '1', DESTINATION: 'addr' };
        const out = await resolveDisplayTickers('SEND', params, names);
        expect(out).to.equal(params);
    });

    it('keeps the ^id and never throws when lookup throws', async () => {
        const boom = async () => { throw new Error('offline'); };
        const out = await resolveDisplayTickers('SEND', { TICK: '^11' }, boom);
        expect(out.TICK).to.equal('^11');
    });
});
