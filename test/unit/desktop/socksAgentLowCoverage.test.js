/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';

import {
    DEFAULT_SOCKS,
    SocksError,
    createSocksAgents,
    parseSocksAddress,
    probeSocks,
    socksConnect,
} from '../../../packages/desktop/main/socksAgent.js';

const servers = [];
const sockets = new Set();

async function listen(onConnection) {
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
        onConnection(socket);
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server.address().port;
}

afterEach(async () => {
    vi.restoreAllMocks();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function successProxy() {
    return listen((socket) => {
        socket.once('data', () => {
            socket.write(Buffer.from([0x05, 0x00]));
            socket.once('data', () => socket.write(Buffer.from([0x05, 0x00])));
        });
    });
}

describe('SOCKS address parsing branches', () => {
    it.each([undefined, null, '', '   '])('uses the Tor default for %j', (value) => {
        expect(parseSocksAddress(value)).toEqual(DEFAULT_SOCKS);
    });

    it.each([
        ['proxy.local', { host: 'proxy.local', port: 9050 }],
        ['proxy.local:1080', { host: 'proxy.local', port: 1080 }],
        ['socks5://proxy.local:1080', { host: 'proxy.local', port: 1080 }],
        ['SOCKS5H://proxy.local:9051', { host: 'proxy.local', port: 9051 }],
    ])('parses %s', (value, expected) => {
        expect(parseSocksAddress(value)).toEqual(expected);
    });

    it.each(['host/path', 'host:name', ':9050', 'host:0', 'host:65536', 'host:999999'])
        ('rejects %s', (value) => {
            expect(() => parseSocksAddress(value)).toThrow(SocksError);
        });
});

describe('SOCKS connection branches', () => {
    it('rejects a non-SOCKS greeting', async () => {
        const proxyPort = await listen((socket) => {
            socket.once('data', () => socket.write(Buffer.from([0x04, 0x00])));
        });
        await expect(socksConnect({
            proxyHost: '127.0.0.1', proxyPort, host: 'example.com', port: 80,
        })).rejects.toThrow(/not a SOCKS5 proxy/);
    });

    it('rejects a proxy that requires authentication', async () => {
        const proxyPort = await listen((socket) => {
            socket.once('data', () => socket.write(Buffer.from([0x05, 0x02])));
        });
        await expect(socksConnect({
            proxyHost: '127.0.0.1', proxyPort, host: 'example.com', port: 80,
        })).rejects.toThrow(/requires authentication/);
    });

    it('opens a domain-name tunnel and lets the caller close it', async () => {
        let request;
        const proxyPort = await listen((socket) => {
            socket.once('data', () => {
                socket.write(Buffer.from([0x05, 0x00]));
                socket.once('data', (data) => {
                    request = data;
                    socket.write(Buffer.from([0x05, 0x00]));
                });
            });
        });

        const socket = await socksConnect({
            proxyHost: '127.0.0.1', proxyPort, host: 'example.com', port: 443,
        });
        expect(request[3]).toBe(0x03);
        expect(request.subarray(5, 16).toString()).toBe('example.com');
        socket.destroy();
    });

    it('reports an unreachable proxy without falling back', async () => {
        const server = net.createServer();
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        await new Promise((resolve) => server.close(resolve));

        await expect(socksConnect({
            proxyHost: '127.0.0.1', proxyPort: port, host: 'example.com', port: 443,
        })).rejects.toThrow(/cannot reach the SOCKS proxy/);
        const result = await probeSocks({ host: '127.0.0.1', port });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/cannot reach the SOCKS proxy/);
    });

    it('destroys a successful probe socket', async () => {
        const proxyPort = await successProxy();

        await expect(probeSocks({ host: '127.0.0.1', port: proxyPort }))
            .resolves.toEqual({ ok: true });
    });
});

describe('SOCKS agent callback branches', () => {
    it('wraps an HTTPS agent tunnel with TLS using the host as fallback SNI', async () => {
        const proxyPort = await successProxy();
        const secure = new EventEmitter();
        const connectTls = vi.spyOn(tls, 'connect').mockReturnValue(secure);
        const { httpsAgent } = createSocksAgents({ host: '127.0.0.1', port: proxyPort });
        const result = new Promise((resolve) => {
            httpsAgent.createConnection({ host: 'example.com', port: 443 }, (error, socket) => {
                resolve({ error, socket });
            });
        });
        await vi.waitFor(() => expect(connectTls).toHaveBeenCalledOnce());
        secure.emit('secureConnect');

        await expect(result).resolves.toEqual({ error: null, socket: secure });
        expect(connectTls).toHaveBeenCalledWith(expect.objectContaining({ servername: 'example.com' }));
    });

    it('forwards TLS errors from an HTTPS agent tunnel', async () => {
        const proxyPort = await successProxy();
        const secure = new EventEmitter();
        vi.spyOn(tls, 'connect').mockReturnValue(secure);
        const { httpsAgent } = createSocksAgents({ host: '127.0.0.1', port: proxyPort });
        const result = new Promise((resolve) => {
            httpsAgent.createConnection({ host: 'example.com', servername: 'sni.example', port: 443 }, (error) => {
                resolve(error);
            });
        });
        await vi.waitFor(() => expect(tls.connect).toHaveBeenCalledOnce());
        secure.emit('error', new Error('TLS failed'));

        await expect(result).resolves.toEqual(expect.objectContaining({ message: 'TLS failed' }));
        expect(tls.connect).toHaveBeenCalledWith(expect.objectContaining({ servername: 'sni.example' }));
    });

    it('returns a plain tunnel from the undici HTTP connector', async () => {
        const proxyPort = await successProxy();
        const { connect } = createSocksAgents({ host: '127.0.0.1', port: proxyPort });
        const result = new Promise((resolve) => {
            connect({ hostname: 'example.com', protocol: 'http:' }, (error, socket) => {
                resolve({ error, socket });
            });
        });

        const { error, socket } = await result;
        expect(error).toBeNull();
        expect(socket).toBeInstanceOf(net.Socket);
        socket.destroy();
    });

    it('wraps the undici HTTPS connector with TLS and forwards dial failures', async () => {
        const proxyPort = await successProxy();
        const secure = new EventEmitter();
        vi.spyOn(tls, 'connect').mockReturnValue(secure);
        const { connect } = createSocksAgents({ host: '127.0.0.1', port: proxyPort });
        const secured = new Promise((resolve) => {
            connect({ hostname: 'example.com', servername: 'sni.example', protocol: 'https:' },
                (error, socket) => resolve({ error, socket }));
        });
        await vi.waitFor(() => expect(tls.connect).toHaveBeenCalledOnce());
        secure.emit('secureConnect');
        await expect(secured).resolves.toEqual({ error: null, socket: secure });

        const closedServer = net.createServer();
        await new Promise((resolve) => closedServer.listen(0, '127.0.0.1', resolve));
        const closedPort = closedServer.address().port;
        await new Promise((resolve) => closedServer.close(resolve));
        const failed = new Promise((resolve) => {
            createSocksAgents({ host: '127.0.0.1', port: closedPort }).connect(
                { hostname: 'example.com', protocol: 'http:' },
                (error) => resolve(error),
            );
        });
        await expect(failed).resolves.toBeInstanceOf(SocksError);
    });
});
