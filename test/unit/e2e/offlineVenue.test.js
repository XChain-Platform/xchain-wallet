// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, it } from 'vitest';

import { classifyRequest, emptyBatchBody } from '../../e2e/fixtures/offlineVenue.js';

it('answers the batch balances route and refuses every other external request', () => {
    expect(classifyRequest('POST', 'https://explorer.xchain.io/BTC/api/balances')).toBe('balances');
    expect(classifyRequest('GET', 'https://explorer.xchain.io/BTC/api/status')).toBe('refuse');
    expect(classifyRequest('POST', 'https://hub.xchain.io/BTC')).toBe('refuse');
    expect(classifyRequest('GET', 'https://example.test/')).toBe('refuse');
});

it('leaves extension pages and loopback alone', () => {
    expect(classifyRequest('GET', 'chrome-extension://abc/popup.html')).toBe('pass');
    expect(classifyRequest('GET', 'http://127.0.0.1:41739/')).toBe('pass');
    expect(classifyRequest('GET', 'http://localhost:5173/')).toBe('pass');
});

it('builds one empty entry per requested address', () => {
    const body = emptyBatchBody({ addresses: ['a1', 'a2'] });
    expect(Object.keys(body)).toEqual(['a1', 'a2']);
    expect(body.a1).toEqual({
        balances: { total: 0, data: [] },
        address: { balances: { confirmed: '0' } },
        error: null,
    });
    expect(emptyBatchBody(null)).toEqual({});
});
