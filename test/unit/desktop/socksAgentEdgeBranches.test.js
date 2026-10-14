/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';

import {
    SocksError,
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
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function handshakeServer(reply) {
    return listen((socket) => {
        socket.once('data', () => {
            socket.write(Buffer.from([0x05, 0x00]));
            socket.once('data', () => socket.write(reply));
        });
    });
}

describe('SOCKS handshake error branches', () => {
    it('times out when a connected proxy never answers', async () => {
        const proxyPort = await listen(() => {});

        await expect(socksConnect({
            proxyHost: '127.0.0.1', proxyPort, host: 'example.com', port: 443, timeoutMs: 25,
        })).rejects.toThrow(/did not answer in 25ms/);
    });

    it('refuses a hostname that cannot fit in a SOCKS5 domain field', async () => {
        const proxyPort = await listen((socket) => {
            socket.once('data', () => socket.write(Buffer.from([0x05, 0x00])));
        });

        await expect(socksConnect({
            proxyHost: '127.0.0.1', proxyPort, host: 'a'.repeat(256), port: 443,
        })).rejects.toThrow(/hostname too long/);
    });

    it('rejects malformed, known, and unknown proxy replies', async () => {
        const malformedPort = await handshakeServer(Buffer.from([0x04, 0x00]));
        await expect(socksConnect({
            proxyHost: '127.0.0.1', proxyPort: malformedPort, host: 'example.com', port: 443,
        })).rejects.toThrow(/malformed SOCKS5 reply/);

        const refusedPort = await handshakeServer(Buffer.from([0x05, 0x05]));
        await expect(socksConnect({
            proxyHost: '127.0.0.1', proxyPort: refusedPort, host: 'example.com', port: 443,
        })).rejects.toThrow(/connection refused/);

        const unknownPort = await handshakeServer(Buffer.from([0x05, 0xfe]));
        await expect(socksConnect({
            proxyHost: '127.0.0.1', proxyPort: unknownPort, host: 'example.com', port: 443,
        })).rejects.toThrow(/unknown error 0xfe/);
    });

    it('treats a SOCKS refusal as proof that the configured proxy is alive', async () => {
        const proxyPort = await handshakeServer(Buffer.from([0x05, 0x02]));

        await expect(probeSocks({ host: '127.0.0.1', port: proxyPort })).resolves.toEqual({ ok: true });
    });

    it('rejects immediately when the proxy disconnects during the handshake', async () => {
        const proxyPort = await listen((socket) => socket.end());

        const result = await Promise.race([
            socksConnect({
                proxyHost: '127.0.0.1', proxyPort, host: 'example.com', port: 443, timeoutMs: 1_000,
            }).then(
                () => ({ state: 'resolved' }),
                (error) => ({ state: 'rejected', error }),
            ),
            new Promise((resolve) => setTimeout(() => resolve({ state: 'pending' }), 75)),
        ]);
        expect(result.state).toBe('rejected');
        expect(result.error).toBeInstanceOf(SocksError);
        expect(result.error.message).toBe('SOCKS proxy closed during handshake');
    });
});
