// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { linkHandoffModel } from '../../../packages/web/src/routes/linkHandoffModel.js';

const GET_HREF = 'https://xchain.io/wallet/download/';

function modelFor(payload) {
    return linkHandoffModel(`?uri=${encodeURIComponent(payload)}`);
}

describe('linkHandoffModel', () => {
    it.each([
        ['xchain:BTC/send?to=bc1qexample&amount=1', 'send'],
        ['xchain:BTC/receive?amount=2', 'receive'],
        ['xchain:BTC/execute?data=00', 'execute'],
        ['xchain:request?v=1&req=example', 'request'],
    ])('builds the hand-off model for %s', (payload, action) => {
        expect(modelFor(payload)).toEqual({
            payload,
            action,
            appHref: payload,
            webHref: `/?uri=${encodeURIComponent(payload)}`,
            getHref: GET_HREF,
        });
    });

    it('accepts an upper-case XCHAIN scheme', () => {
        expect(modelFor('XCHAIN:BTC/SEND?amount=1')?.action).toBe('send');
    });

    it('preserves reserved characters and spaces through webHref', () => {
        const payload = 'xchain:BTC/send?memo=one & two#+plus';
        const model = modelFor(payload);

        expect(model.payload).toBe(payload);
        expect(decodeURIComponent(model.webHref.slice('/?uri='.length))).toBe(payload);
    });

    it.each([
        ['bitcoin:BTC/send?amount=1'],
        ['https://xchain.io/'],
        ['javascript:alert(1)'],
        [''],
    ])('rejects the unsupported payload %j', (payload) => {
        expect(modelFor(payload)).toBeNull();
    });

    it('returns null when uri is missing', () => {
        expect(linkHandoffModel('?other=value')).toBeNull();
    });

    it('returns null for a non-string argument', () => {
        expect(linkHandoffModel(null)).toBeNull();
    });

    it('classifies an unknown verb as other', () => {
        expect(modelFor('xchain:BTC/swap?amount=1')?.action).toBe('other');
    });
});
