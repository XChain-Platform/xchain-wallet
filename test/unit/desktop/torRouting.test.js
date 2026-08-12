/**
 * @vitest-environment node
 *
 * Node, not jsdom: this is Electron main-process code and it opens real
 * TCP sockets against a real SOCKS5 server started by the test.
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Tor routing, which the wallet promised and did not do.
//
// The toggle existed, said "Route SDK requests through a local Tor
// SOCKS5 proxy when available", and had no consumer anywhere in the
// wallet or the SDK. A user who turned it on was told their traffic was
// anonymised while every request went straight out from their own IP
// carrying the addresses they watch.
//
// So the assertions that matter here are not "the function returns ok".
// They are: a real request arrives at a real SOCKS server, the proxy is
// told the HOSTNAME rather than an address we resolved (a local DNS
// lookup would leak every destination while looking like it worked),
// and a missing proxy FAILS instead of quietly going direct.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';

import {
    parseSocksAddress,
    socksConnect,
    createSocksAgents,
    probeSocks,
    SocksError,
    DEFAULT_SOCKS,
} from '../../../packages/desktop/main/socksAgent.js';
import {
    applyTorRouting,
    readTorSettings,
    resetTorRoutingState,
} from '../../../packages/desktop/main/torRouting.js';

// --- a real SOCKS5 server that records every CONNECT --------------------

let proxyServer;
let originServer;
let proxyPort;
let originPort;
let proxySaw = [];
let originSaw = [];

function startSocksServer() {
    return new Promise((resolve) => {
        const srv = net.createServer((client) => {
            client.once('data', (greeting) => {
                if (greeting[0] !== 0x05) return client.destroy();
                client.write(Buffer.from([0x05, 0x00]));
                client.once('data', (req) => {
                    if (req[3] !== 0x03) return client.destroy();
                    const len = req[4];
                    const host = req.slice(5, 5 + len).toString();
                    const port = req.readUInt16BE(5 + len);
                    proxySaw.push({ host, port });
                    const up = net.connect(port, '127.0.0.1', () => {
                        client.write(Buffer.from([0x05, 0, 0, 0x01, 0, 0, 0, 0, 0, 0]));
                        client.pipe(up);
                        up.pipe(client);
                    });
                    up.on('error', () => client.destroy());
                });
            });
        });
        srv.listen(0, '127.0.0.1', () => resolve(srv));
    });
}

beforeAll(async () => {
    proxyServer = await startSocksServer();
    proxyPort = proxyServer.address().port;
    originServer = http.createServer((req, res) => {
        originSaw.push(req.url);
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":true}');
    });
    await new Promise((r) => originServer.listen(0, '127.0.0.1', r));
    originPort = originServer.address().port;
}, 20_000);

afterAll(() => {
    proxyServer?.close();
    originServer?.close();
});

beforeEach(() => {
    proxySaw = [];
    originSaw = [];
    resetTorRoutingState();
});

// --- address parsing ----------------------------------------------------

describe('parseSocksAddress', () => {
    it('defaults to Tor on localhost', () => {
        expect(parseSocksAddress()).toEqual(DEFAULT_SOCKS);
        expect(parseSocksAddress('')).toEqual({ host: '127.0.0.1', port: 9050 });
    });

    it('accepts host:port and a socks5:// prefix', () => {
        expect(parseSocksAddress('10.0.0.2:1080')).toEqual({ host: '10.0.0.2', port: 1080 });
        expect(parseSocksAddress('socks5://tor.local:9150')).toEqual({ host: 'tor.local', port: 9150 });
        expect(parseSocksAddress('socks5h://tor.local:9150')).toEqual({ host: 'tor.local', port: 9150 });
    });

    it('refuses a malformed address instead of silently using the default', () => {
        // Falling back would send traffic somewhere the user did not pick
        // while the UI showed their typo as accepted.
        for (const bad of ['host:notaport', 'a b', 'host:99999', 'host:0']) {
            expect(() => parseSocksAddress(bad)).toThrow(SocksError);
        }
    });
});

// --- the tunnel ---------------------------------------------------------

describe('socksConnect', () => {
    it('opens a tunnel and hands the PROXY the hostname, not a resolved IP', async () => {
        const sock = await socksConnect({
            proxyHost: '127.0.0.1', proxyPort, host: 'localhost', port: originPort,
        });
        sock.destroy();
        // The whole privacy point: if we resolved 'localhost' ourselves and
        // sent ATYP 0x01, every destination would go to the user's DNS
        // resolver in cleartext while this test still passed on 'connects'.
        expect(proxySaw).toEqual([{ host: 'localhost', port: originPort }]);
    });

    it('reports an unreachable proxy rather than hanging', async () => {
        await expect(socksConnect({
            proxyHost: '127.0.0.1', proxyPort: 1, host: 'localhost', port: originPort,
        })).rejects.toThrow(/cannot reach the SOCKS proxy/);
    });

    it('refuses a server that is not SOCKS5', async () => {
        const notSocks = net.createServer((c) => c.write(Buffer.from([0x04, 0x00])));
        await new Promise((r) => notSocks.listen(0, '127.0.0.1', r));
        try {
            await expect(socksConnect({
                proxyHost: '127.0.0.1', proxyPort: notSocks.address().port,
                host: 'localhost', port: originPort,
            })).rejects.toThrow(/not a SOCKS5 proxy/);
        } finally { notSocks.close(); }
    });

    it('refuses a proxy demanding authentication rather than guessing', async () => {
        const needsAuth = net.createServer((c) => {
            c.once('data', () => c.write(Buffer.from([0x05, 0x02])));
        });
        await new Promise((r) => needsAuth.listen(0, '127.0.0.1', r));
        try {
            await expect(socksConnect({
                proxyHost: '127.0.0.1', proxyPort: needsAuth.address().port,
                host: 'localhost', port: originPort,
            })).rejects.toThrow(/requires authentication/);
        } finally { needsAuth.close(); }
    });
});

// --- agents -------------------------------------------------------------

describe('createSocksAgents', () => {
    it('routes a real http request through the proxy', async () => {
        const { httpAgent } = createSocksAgents({ host: '127.0.0.1', port: proxyPort });
        const body = await new Promise((resolve, reject) => {
            const req = http.get(
                { host: 'localhost', port: originPort, path: '/agent', agent: httpAgent },
                (res) => {
                    let out = '';
                    res.on('data', (d) => { out += d; });
                    res.on('end', () => resolve(out));
                },
            );
            req.on('error', reject);
        });
        expect(body).toBe('{"ok":true}');
        expect(originSaw).toEqual(['/agent']);
        expect(proxySaw).toEqual([{ host: 'localhost', port: originPort }]);
    });

    it('FAILS CLOSED when the proxy is gone: the origin is never reached', async () => {
        // The failure mode that would recreate the original bug is a
        // silent fallback to a direct connection. The request must error.
        const { httpAgent } = createSocksAgents({ host: '127.0.0.1', port: 1 });
        await expect(new Promise((resolve, reject) => {
            const req = http.get(
                { host: 'localhost', port: originPort, path: '/never', agent: httpAgent },
                (res) => resolve(res.statusCode),
            );
            req.on('error', reject);
        })).rejects.toThrow(/cannot reach the SOCKS proxy/);
        expect(originSaw).toEqual([]);
    });
});

describe('probeSocks', () => {
    it('finds a live proxy', async () => {
        expect(await probeSocks({ host: '127.0.0.1', port: proxyPort })).toEqual({ ok: true });
    });

    it('reports a dead one with a reason worth showing a user', async () => {
        const result = await probeSocks({ host: '127.0.0.1', port: 1 });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/cannot reach the SOCKS proxy/);
    });
});

// --- the applier --------------------------------------------------------

describe('readTorSettings', () => {
    it('is off unless the setting says otherwise', () => {
        expect(readTorSettings({}).enabled).toBe(false);
        expect(readTorSettings({ privacy: {} }).enabled).toBe(false);
        expect(readTorSettings({ privacy: { torRouting: true } })).toEqual({
            enabled: true, proxy: DEFAULT_SOCKS,
        });
    });

    it('keeps the Tor default when the address is unusable', () => {
        // Never resolve a bad address to "no proxy": that is the toggle
        // reading on while traffic goes direct.
        const r = readTorSettings({ privacy: { torRouting: true, socksProxyAddress: 'nonsense:port' } });
        expect(r.enabled).toBe(true);
        expect(r.proxy).toEqual(DEFAULT_SOCKS);
    });
});

describe('applyTorRouting', () => {
    const makeRegistry = () => {
        const pools = [];
        return { pools, setPool: (p) => pools.push(p === null ? 'CLEARED' : 'SOCKS') };
    };

    it('does nothing when the setting is off', async () => {
        const registry = makeRegistry();
        const result = await applyTorRouting({
            settings: { privacy: { torRouting: false } }, sdkRegistry: registry,
        });
        expect(result).toEqual({ on: false });
        expect(registry.pools).toEqual([]);
    });

    it('routes all three egress paths when on', async () => {
        const registry = makeRegistry();
        const proxyCalls = [];
        const result = await applyTorRouting({
            settings: {
                privacy: { torRouting: true, socksProxyAddress: `127.0.0.1:${proxyPort}` },
            },
            sdkRegistry: registry,
            session: { setProxy: async (cfg) => { proxyCalls.push(cfg); } },
        });

        expect(result.on).toBe(true);
        expect(result.reachable).toBe(true);
        // 1. the SDK's axios clients
        expect(registry.pools).toEqual(['SOCKS']);
        // 2. Chromium, with the bypass that stops it resolving DNS itself
        expect(proxyCalls.at(-1).proxyRules).toBe(`socks5://127.0.0.1:${proxyPort}`);
        expect(proxyCalls.at(-1).proxyBypassRules).toBe('<-loopback>');
        // 3. global fetch, proven by the proxy seeing the request
        proxySaw = [];
        await fetch(`http://localhost:${originPort}/fetched`).then((r) => r.text());
        expect(proxySaw).toEqual([{ host: 'localhost', port: originPort }]);

        // and turning it off restores every one of them
        proxySaw = [];
        await applyTorRouting({
            settings: { privacy: { torRouting: false } },
            sdkRegistry: registry,
            session: { setProxy: async (cfg) => { proxyCalls.push(cfg); } },
        });
        expect(registry.pools).toEqual(['SOCKS', 'CLEARED']);
        expect(proxyCalls.at(-1).mode).toBe('direct');
        await fetch(`http://localhost:${originPort}/afterwards`).then((r) => r.text());
        expect(proxySaw).toEqual([]);
    }, 20_000);

    it('still applies routing when the proxy is unreachable, and says so', async () => {
        // Refusing to apply would mean the toggle reads on while traffic
        // goes direct, which is exactly the bug being fixed. Apply, and
        // report that nothing is listening.
        const registry = makeRegistry();
        const result = await applyTorRouting({
            settings: { privacy: { torRouting: true, socksProxyAddress: '127.0.0.1:1' } },
            sdkRegistry: registry,
        });
        expect(result.on).toBe(true);
        expect(result.reachable).toBe(false);
        expect(result.reason).toMatch(/cannot reach the SOCKS proxy/);
        expect(registry.pools).toEqual(['SOCKS']);
        await applyTorRouting({ settings: {}, sdkRegistry: registry });
    });
});
