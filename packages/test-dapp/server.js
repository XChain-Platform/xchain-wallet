// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { claimLogin } from './claimRule.js';

const packageDirectory = fileURLToPath(new URL('.', import.meta.url));
const defaultPublicDirectory = join(packageDirectory, 'public');
const defaultConnectDirectory = join(packageDirectory, '..', 'connect', 'src');
const bodyLimit = 10_240;
const nonceLifetimeMs = 10 * 60 * 1_000;

const contentTypes = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
]);

function token() {
    return randomBytes(16).toString('base64url');
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export function createCallbackStore({ now = Date.now } = {}) {
    const nonces = new Map();
    const records = new Map();

    return {
        issueNonce(mode = 'same-device') {
            if (mode !== 'same-device' && mode !== 'cross-device') {
                throw new TypeError('nonce mode must be same-device or cross-device');
            }
            const nonce = token();
            nonces.set(nonce, { mode, expiresAt: now() + nonceLifetimeMs });
            return nonce;
        },
        takeNonce(nonce) {
            const entry = nonces.get(nonce);
            nonces.delete(nonce);
            if (!entry || entry.expiresAt <= now()) return null;
            return { mode: entry.mode };
        },
        put(id, record) {
            records.set(id, record);
        },
        get(id) {
            return records.get(id) ?? null;
        },
    };
}

function sendJson(response, status, value) {
    response.writeHead(status, {
        'cache-control': 'no-store',
        'content-type': contentTypes.get('.json'),
        'x-content-type-options': 'nosniff',
    });
    response.end(JSON.stringify(value));
}

async function readJson(request) {
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
        length += chunk.length;
        if (length > bodyLimit) throw new RangeError('request body is too large');
        chunks.push(chunk);
    }
    if (length === 0) return Object.create(null);
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!isPlainObject(value)) throw new TypeError('request body must be an object');
    return value;
}

function requestOrigin(request) {
    const host = request.headers.host;
    if (typeof host !== 'string' || host.length === 0) return null;
    try {
        return new URL(`http://${host}`).origin;
    } catch {
        return null;
    }
}

function statusForClaim(reason) {
    if (reason === 'NO_RECORD') return 404;
    if (reason === 'ALREADY_CLAIMED') return 409;
    return 400;
}

function fileForPath(pathname, publicDirectory, connectDirectory) {
    if (pathname === '/' || pathname === '/index.html') {
        return join(publicDirectory, 'index.html');
    }
    const match = /^\/connect\/([A-Za-z][A-Za-z0-9.-]*\.js)$/.exec(pathname);
    return match ? join(connectDirectory, match[1]) : null;
}

async function sendFile(response, pathname, publicDirectory, connectDirectory) {
    const path = fileForPath(pathname, publicDirectory, connectDirectory);
    if (path === null) return false;
    try {
        const contents = await readFile(path);
        response.writeHead(200, {
            'cache-control': 'no-store',
            'content-type': contentTypes.get(extname(path)) ?? 'application/octet-stream',
            'x-content-type-options': 'nosniff',
        });
        response.end(contents);
    } catch {
        sendJson(response, 404, { ok: false, error: 'NOT_FOUND' });
    }
    return true;
}

export function createTestDappServer({
    auth = null,
    store = createCallbackStore(),
    appId = 'xchain-test-dapp',
    publicDirectory = defaultPublicDirectory,
    connectDirectory = defaultConnectDirectory,
} = {}) {
    return createServer(async (request, response) => {
        try {
            const url = new URL(request.url ?? '/', 'http://test.invalid');

            if (request.method === 'GET'
                && await sendFile(response, url.pathname, publicDirectory, connectDirectory)) {
                return;
            }

            if (request.method === 'POST' && url.pathname === '/nonce') {
                const body = await readJson(request);
                const mode = body.mode ?? 'same-device';
                sendJson(response, 201, { ok: true, nonce: await store.issueNonce(mode), mode });
                return;
            }

            if (request.method === 'POST' && url.pathname === '/callback') {
                if (typeof auth?.receiveCallback !== 'function') {
                    sendJson(response, 503, { ok: false, error: 'CALLBACK_VERIFIER_UNAVAILABLE' });
                    return;
                }
                const body = await readJson(request);
                const origin = requestOrigin(request);
                if (origin === null) {
                    sendJson(response, 400, { ok: false, error: 'BAD_ORIGIN' });
                    return;
                }
                const result = await auth.receiveCallback(body, { store, appId, origin });
                sendJson(response, result?.accepted === true ? 202 : 400, result);
                return;
            }

            const claimMatch = /^\/claim\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
            if (request.method === 'POST' && claimMatch) {
                const id = claimMatch[1];
                const presented = await readJson(request);
                const result = claimLogin(await store.get(id), presented);
                if (!result.ok) {
                    sendJson(response, statusForClaim(result.reason), result);
                    return;
                }
                await store.put(id, result.record);
                sendJson(response, 200, { ok: true, address: result.address });
                return;
            }

            const resultMatch = /^\/result\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
            if (request.method === 'GET' && resultMatch) {
                const record = await store.get(resultMatch[1]);
                sendJson(response, record === null ? 404 : 200, record === null
                    ? { ok: false, error: 'NOT_FOUND' }
                    : { ok: true, status: record.status, claimed: record.claimed === true });
                return;
            }

            sendJson(response, 404, { ok: false, error: 'NOT_FOUND' });
        } catch (error) {
            const status = error instanceof RangeError ? 413 : 400;
            sendJson(response, status, { ok: false, error: 'BAD_REQUEST' });
        }
    });
}

async function loadInstalledAuth() {
    try {
        const { createRequire } = await import('node:module');
        const requireFromExtension = createRequire(new URL('../extension/package.json', import.meta.url));
        const sdkPackage = requireFromExtension('xchain-sdk');
        const sdk = new sdkPackage.XChainSDK({ network: 'bitcoin-regtest' });
        return typeof sdk.auth?.receiveCallback === 'function' ? sdk.auth : null;
    } catch {
        return null;
    }
}

export async function startTestDappServer({ port = 5500, host = '127.0.0.1' } = {}) {
    const server = createTestDappServer({ auth: await loadInstalledAuth() });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
    });
    return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const server = await startTestDappServer();
    const address = server.address();
    process.stdout.write(`Test dApp listening on http://${address.address}:${address.port}\n`);
}
