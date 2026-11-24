// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer as createSecureServer } from 'node:https';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, expect } from '@playwright/test';

import { decodeRequestLink } from '../../../fixtures/siteRequest.js';
import { createCallbackStore, createTestDappServer } from '../../../../../packages/test-dapp/server.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));

export const WALLET_ROOT = resolve(HERE, '../../../../..');
export const EXTENSION_DIST = resolve(WALLET_ROOT, 'packages/extension/dist');
export const WEB_PORT = Number(process.env.E2E_SITE_REQUEST_PORT ?? 5491);
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
export const CLAIM = 'cCcCcCcCcCcCcCcCcCcCcC';
export const REQUEST_ID = 'AAAAAAAAAAAAAAAAAAAAAA';
export const ADDRESS = 'bcrt1qsiterequestroundtrip0000000000000000';

export function loginEnvelope({ dappOrigin, withReturn = true, id = REQUEST_ID }) {
    return {
        v: 1,
        id,
        method: 'login',
        params: { appId: 'xchain-test-dapp', nonce: 'round-trip-nonce', chains: ['bitcoin-regtest'] },
        ...(withReturn ? { return: `${dappOrigin}/` } : {}),
        callback: `${dappOrigin}/callback`,
        app: { name: 'XChain test dApp' },
        developerMode: true,
    };
}

export function tool(command, args) {
    const found = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000 });
    if (found.error || found.status !== 0) {
        throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed: ${found.error?.message ?? found.stderr}`);
    }
    return found.stdout;
}

export function androidSerial() {
    if (process.env.ANDROID_SERIAL) return process.env.ANDROID_SERIAL;
    const attached = tool('adb', ['devices']).split('\n').slice(1)
        .map((line) => line.split('\t'))
        .filter(([, state]) => state?.trim() === 'device')
        .map(([name]) => name);
    if (attached.length !== 1) throw new Error(`expected one attached Android device, found ${attached.length}; set ANDROID_SERIAL`);
    return attached[0];
}

export function iosUdid() {
    if (process.env.XCHAIN_IOS_UDID) return process.env.XCHAIN_IOS_UDID;
    const booted = [...tool('xcrun', ['simctl', 'list', 'devices', 'booted']).matchAll(/\(([0-9A-F-]{36})\) \(Booted\)/g)];
    if (booted.length !== 1) throw new Error(`expected one booted iOS simulator, found ${booted.length}; set XCHAIN_IOS_UDID`);
    return booted[0][1];
}

export async function until(read, { timeout = 30_000, step = 500 } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    for (;;) {
        last = read();
        if (last) return last;
        if (Date.now() > deadline) return last;
        await new Promise((done) => { setTimeout(done, step); });
    }
}

async function listen(server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
}

function throwawayCertificate() {
    const directory = mkdtempSync(resolve(tmpdir(), 'site-request-cert-'));
    const key = resolve(directory, 'key.pem');
    const cert = resolve(directory, 'cert.pem');
    const made = spawnSync('openssl', [
        'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
        '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1',
        '-addext', 'subjectAltName=IP:127.0.0.1',
    ], { encoding: 'utf8' });
    if (made.status !== 0) throw new Error('openssl could not make the throwaway certificate');
    return { key: readFileSync(key), cert: readFileSync(cert) };
}

export async function startDapp() {
    const store = createCallbackStore();
    const server = createTestDappServer({ store });
    const origin = await listen(server);
    const secure = createSecureServer(throwawayCertificate(), server.listeners('request')[0]);
    secure.listen(0, '127.0.0.1');
    await once(secure, 'listening');
    return {
        origin,
        secureOrigin: `https://127.0.0.1:${secure.address().port}`,
        store,
        close: () => Promise.all([server, secure].map((listener) => new Promise((done) => {
            listener.close(done);
            listener.closeAllConnections();
        }))),
    };
}

export const test = base.extend({
    ignoreHTTPSErrors: true,
    dapp: async ({}, use) => { // eslint-disable-line no-empty-pattern
        const dapp = await startDapp();
        await use(dapp);
        await dapp.close();
    },
});

export { expect };
