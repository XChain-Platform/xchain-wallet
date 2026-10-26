// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { expect, test, vi } from 'vitest';

import { hubRegistryBody } from '../../e2e/fixtures/hubStub.js';
import {
    guardOutbound,
    isLocalUrl,
    isStubbedUrl,
    stubOutboundHosts,
    XCHAIN_SERVICE_HOSTS,
} from '../../e2e/fixtures/outboundGuard.js';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/descriptors/index.js';

test('the hub stub serves the bundled descriptors in the shape the sync expects', () => {
    const body = hubRegistryBody();
    expect(body.schema_version).toBe(1);
    expect(body.descriptors).toBe(BUNDLED_DESCRIPTORS);
    expect(body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('the outbound guard treats loopback and inline schemes as local only', () => {
    expect(isLocalUrl('http://localhost:5473/')).toBe(true);
    expect(isLocalUrl('ws://127.0.0.1:5473/')).toBe(true);
    expect(isLocalUrl('data:text/html,x')).toBe(true);
    expect(isLocalUrl('https://hub.xchain.io/api/v1/chain-registry')).toBe(false);
    expect(isLocalUrl('wss://explorer.example/ws')).toBe(false);
});

test('the regtest stubs cover each production service host exactly', () => {
    expect(isStubbedUrl('https://explorer.xchain.io/BTC/api/balances', XCHAIN_SERVICE_HOSTS)).toBe(true);
    expect(isStubbedUrl('https://hub.xchain.io/BTC', XCHAIN_SERVICE_HOSTS)).toBe(true);
    expect(isStubbedUrl('https://encoder.xchain.io/BTC', XCHAIN_SERVICE_HOSTS)).toBe(true);
    expect(isStubbedUrl('wss://explorer.xchain.io/ws', XCHAIN_SERVICE_HOSTS)).toBe(true);
    expect(isStubbedUrl('https://explorer.xchain.io.evil.example/', XCHAIN_SERVICE_HOSTS)).toBe(false);
    expect(isStubbedUrl('https://example.test/', XCHAIN_SERVICE_HOSTS)).toBe(false);
});

test('the production host stubs answer boot probes and blackhole other paths', async () => {
    let handler;
    const context = {
        route: vi.fn(async (pattern, callback) => {
            expect(pattern).toBe('**/*');
            handler = callback;
        }),
    };
    await stubOutboundHosts(context, XCHAIN_SERVICE_HOSTS);

    const dispatch = async (method, url, body = null) => {
        const route = {
            request: () => ({ method: () => method, url: () => url, postDataJSON: () => body }),
            abort: vi.fn(),
            fallback: vi.fn(),
            fulfill: vi.fn(),
        };
        await handler(route);
        return route;
    };

    const balances = await dispatch('POST', 'https://explorer.xchain.io/BTC/api/balances', {
        addresses: ['bc1qone'],
    });
    expect(JSON.parse(balances.fulfill.mock.calls[0][0].body)).toHaveProperty('bc1qone');

    const status = await dispatch('GET', 'https://explorer.xchain.io/BTC/api/status');
    expect(JSON.parse(status.fulfill.mock.calls[0][0].body).stale).toEqual({ BTC: false });

    for (const host of ['hub.xchain.io', 'encoder.xchain.io']) {
        const ping = await dispatch('POST', `https://${host}/BTC`, { id: 7, method: 'ping' });
        expect(JSON.parse(ping.fulfill.mock.calls[0][0].body)).toEqual({ jsonrpc: '2.0', id: 7, result: true });
    }

    const unsupported = await dispatch('GET', 'https://explorer.xchain.io/BTC/api/transactions');
    expect(unsupported.abort).toHaveBeenCalledWith('internetdisconnected');

    const unknown = await dispatch('GET', 'https://example.test/');
    expect(unknown.fallback).toHaveBeenCalledOnce();
});

test('the guard reports unknown hosts but leaves configured stubs to the transport block', async () => {
    let routeHandler;
    let websocketHandler;
    const page = {
        context: () => ({
            route: async (pattern, callback) => {
                expect(pattern).toBe('**/*');
                routeHandler = callback;
            },
        }),
        on: (event, callback) => {
            expect(event).toBe('websocket');
            websocketHandler = callback;
        },
    };
    const outbound = await guardOutbound(page, { stubbedHosts: XCHAIN_SERVICE_HOSTS });
    const dispatch = async (method, url) => {
        const route = {
            request: () => ({ method: () => method, url: () => url }),
            abort: vi.fn(),
            fallback: vi.fn(),
        };
        await routeHandler(route);
        return route;
    };

    const stubbed = await dispatch('GET', 'https://explorer.xchain.io/BTC/api/status');
    expect(stubbed.abort).toHaveBeenCalledWith('internetdisconnected');
    expect(outbound.attempts).toEqual([]);

    await dispatch('POST', 'https://example.test/rpc');
    websocketHandler({ url: () => 'wss://encoder.xchain.io/BTC' });
    websocketHandler({ url: () => 'wss://other.example/ws' });
    expect(outbound.attempts).toEqual([
        'POST https://example.test/rpc',
        'WS wss://other.example/ws',
    ]);
});

test('the guard lets a live venue through and still reports every other host', async () => {
    let routeHandler;
    let websocketHandler;
    const page = {
        context: () => ({
            route: async (pattern, callback) => {
                routeHandler = callback;
            },
        }),
        on: (event, callback) => {
            websocketHandler = callback;
        },
    };
    const outbound = await guardOutbound(page, { liveHosts: XCHAIN_SERVICE_HOSTS });
    const dispatch = async (url) => {
        const route = {
            request: () => ({ method: () => 'GET', url: () => url }),
            abort: vi.fn(),
            fallback: vi.fn(),
        };
        await routeHandler(route);
        return route;
    };

    const live = await dispatch('https://explorer.xchain.io/TBTC/api/status');
    expect(live.fallback).toHaveBeenCalledOnce();
    expect(live.abort).not.toHaveBeenCalled();

    const other = await dispatch('https://explorer.xchain.io.evil.example/TBTC/api/status');
    expect(other.abort).toHaveBeenCalledWith('blockedbyclient');
    websocketHandler({ url: () => 'wss://encoder.xchain.io/TBTC' });
    expect(outbound.attempts).toEqual(['GET https://explorer.xchain.io.evil.example/TBTC/api/status']);
});
