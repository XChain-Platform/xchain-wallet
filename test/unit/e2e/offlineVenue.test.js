// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, it } from 'vitest';

import { classifyRequest, emptyBatchBody, healthyStatusBody, pingBody } from '../../e2e/fixtures/offlineVenue.js';

it('answers the batch balances route and refuses every other external request', () => {
    expect(classifyRequest('POST', 'https://explorer.xchain.io/BTC/api/balances')).toBe('balances');
    expect(classifyRequest('POST', 'https://hub.xchain.io/BTC')).toBe('refuse');
    expect(classifyRequest('POST', 'https://hub.xchain.io/BTC', { method: 'getcapabilitythresholds' })).toBe('refuse');
    expect(classifyRequest('GET', 'https://hub.xchain.io/api/v1/chain-registry')).toBe('refuse');
    expect(classifyRequest('GET', 'https://explorer.xchain.io/BTC/api/polls/open/status')).toBe('refuse');
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

it('answers the reachability probe: explorer status and the hub and encoder ping', () => {
    expect(classifyRequest('GET', 'https://explorer.xchain.io/DOGE/api/status')).toBe('status');
    expect(classifyRequest('POST', 'https://hub.xchain.io/BTC', { method: 'ping' })).toBe('ping');
    expect(classifyRequest('POST', 'https://encoder.xchain.io/LTC/', { method: 'ping' })).toBe('ping');
    expect(classifyRequest('POST', 'https://example.test/a/b', { method: 'ping' })).toBe('refuse');
    expect(pingBody({ id: 7 })).toEqual({ jsonrpc: '2.0', id: 7, result: true });
    expect(pingBody(null).result).toBe(true);
});

it('reports a current, unhalted tip for the requested coin only', () => {
    expect(healthyStatusBody('BTC')).toEqual({
        stale: { BTC: false },
        last_block: { BTC: 1 },
        tip_age_seconds: { BTC: 0 },
        replica_halted: { BTC: false },
    });
});
