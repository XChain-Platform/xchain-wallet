// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { createClient as createConnectClient } from '../../../packages/connect/src/client.js';
import { DOCS_BRANCH_ROOT, DOCS_ROOT, skipUnlessDocs } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const walletRoot = resolve(here, '..', '..', '..');
const guidePath = join(DOCS_BRANCH_ROOT, 'developer-guide', 'wallet-integration.md');
const canonicalRequestsPath = join(walletRoot, 'packages', 'connect', 'wallet-requests.json');
const copiedRequestsPath = join(DOCS_BRANCH_ROOT, 'protocol', 'json', 'wallet-requests.json');
const nodeRequire = createRequire(import.meta.url);
const requireFromWeb = createRequire(join(walletRoot, 'packages', 'web', 'package.json'));

function resolveSdkEntry() {
    if (process.env.XCHAIN_SDK_ROOT) {
        return join(process.env.XCHAIN_SDK_ROOT, 'index.js');
    }
    try {
        return requireFromWeb.resolve('xchain-sdk');
    } catch {
        return join(resolve(DOCS_ROOT, '..', 'xchain-sdk'), 'index.js');
    }
}

const sdkEntry = resolveSdkEntry();

skipUnlessDocs('wallet integration snippets smoke');

function markdownSection(markdown, heading) {
    const marker = `## ${heading}\n`;
    const start = markdown.indexOf(marker);
    assert.notEqual(start, -1, `guide is missing the "${heading}" section`);
    const contentStart = start + marker.length;
    const next = markdown.indexOf('\n## ', contentStart);
    return markdown.slice(contentStart, next === -1 ? markdown.length : next);
}

function javascriptFence(markdown, heading) {
    const section = markdownSection(markdown, heading);
    const fences = [...section.matchAll(/```js\n([\s\S]*?)\n```/g)];
    assert.equal(fences.length, 1, `the "${heading}" section must contain one JavaScript example`);
    return fences[0][1];
}

function removeDependencyLine(source, pattern, label) {
    const matches = source.match(new RegExp(pattern.source, `${pattern.flags}g`));
    assert.equal(matches?.length, 1, `${label} must appear exactly once in the example`);
    return source.replace(pattern, '');
}

function runSnippet(source, context, name) {
    const script = new vm.Script(`'use strict';\n${source}`, {
        filename: `${guidePath}#${name}`,
    });
    script.runInContext(vm.createContext(context));
}

function memoryStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
    };
}

function responseRecorder() {
    return {
        statusCode: 200,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

function signedLogin(XChainSDK, nonce) {
    const auth = new XChainSDK({ network: 'bitcoin-mainnet' }).auth;
    const wif = 'KyrSGCFPhqZMjCe5fNTYddiLMp4tMj4gLKuJ26TsB2rvr1VJGPbt';
    const probe = auth.signMessage('address probe', wif);
    const timestamp = Date.now() - 100;
    const expiresAt = Date.now() + 60_000;
    const challenge = [
        'XChain Sign-In v2',
        'music.example',
        'https://music.example',
        probe.address,
        nonce,
        timestamp,
        expiresAt,
    ].join(' / ');
    const signed = auth.signMessage(challenge, wif);
    const challengeParts = {
        version: 2,
        appId: 'music.example',
        origin: 'https://music.example',
        address: signed.address,
        nonce,
        timestamp,
        expiresAt,
    };
    const entry = {
        address: signed.address,
        chainId: 'bitcoin-mainnet',
        challenge,
        challengeParts,
        signature: signed.signature,
        signatureFormat: 'legacy',
    };
    return { ok: true, ...entry, addresses: [entry] };
}

test('wallet-requests.json documentation copy is byte-identical to connect', () => {
    const canonical = readFileSync(canonicalRequestsPath);
    const copied = readFileSync(copiedRequestsPath);
    assert.doesNotThrow(() => JSON.parse(canonical.toString('utf8')));
    assert.doesNotThrow(() => JSON.parse(copied.toString('utf8')));
    assert.ok(copied.equals(canonical), 'documentation and connect request schemas differ');
});

test('the guide browser login example runs against the connect client', async () => {
    const guide = readFileSync(guidePath, 'utf8');
    let source = javascriptFence(guide, 'Log in from the browser');
    source = removeDependencyLine(
        source,
        /^import \{ createClient \} from '@dankest-llc\/xchain-connect';\n/m,
        'the connect import',
    );

    const nonce = 'guide-login-nonce';
    const loginResult = { ok: true, address: 'verified-address', chainId: 'bitcoin-testnet' };
    const providerCalls = [];
    const fetchCalls = [];
    const handlers = new Map();
    const fakeWindow = {
        xchain: {
            version: '0.2.0',
            async signIn(params) {
                providerCalls.push(params);
                return loginResult;
            },
        },
        location: { href: 'https://music.example/login', origin: 'https://music.example' },
        history: { state: null, replaceState() {} },
        addEventListener() {},
        localStorage: memoryStorage(),
    };
    const document = {
        querySelector(selector) {
            assert.equal(selector, '#login');
            return {
                addEventListener(type, handler) {
                    assert.equal(type, 'click');
                    handlers.set(type, handler);
                },
            };
        },
    };
    const fetch = async (url, options) => {
        fetchCalls.push({ url, options });
        if (url === '/auth/login-nonce') return { json: async () => ({ nonce }) };
        return { ok: true };
    };
    const createClient = (options) => createConnectClient({
        ...options,
        window: fakeWindow,
        storage: fakeWindow.localStorage,
        platform: 'desktop',
    });

    runSnippet(source, { createClient, document, fetch }, 'browser-login');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof handlers.get('click'), 'function');
    await handlers.get('click')();

    assert.deepEqual(providerCalls.map((value) => ({ ...value })), [
        { appId: 'music.example', nonce },
    ]);
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[1].url, '/auth/verify');
    assert.deepEqual(JSON.parse(fetchCalls[1].options.body), { nonce, result: loginResult });
});

test('the guide receiver example accepts a cross-device login through the SDK', async () => {
    const guide = readFileSync(guidePath, 'utf8');
    let source = javascriptFence(guide, 'Receive results on your server');
    source = removeDependencyLine(
        source,
        /^const crypto = require\('crypto'\);\n/m,
        'the crypto import',
    );
    source = removeDependencyLine(
        source,
        /^const express = require\('express'\);\n/m,
        'the express import',
    );
    source = removeDependencyLine(
        source,
        /^const (?:\{ XChainSDK \}|XChainSDK) = require\('@dankest-llc\/xchain-sdk'\);\n/m,
        'the SDK import',
    );

    const sdkModule = nodeRequire(sdkEntry);
    const XChainSDK = sdkModule.XChainSDK || sdkModule.default || sdkModule;
    assert.equal(typeof XChainSDK, 'function', 'the SDK checkout must export XChainSDK');

    const routes = new Map();
    const app = {
        use() {},
        post(path, handler) { routes.set(path, handler); },
    };
    const express = () => app;
    express.json = (options) => options;

    runSnippet(source, {
        crypto: nodeRequire('node:crypto'),
        express,
        XChainSDK,
    }, 'callback-receiver');

    assert.deepEqual([...routes.keys()], ['/auth/qr-login-nonce', '/auth/callback']);
    const nonceResponse = responseRecorder();
    routes.get('/auth/qr-login-nonce')({}, nonceResponse);
    assert.match(nonceResponse.body.nonce, /^[A-Za-z0-9_-]{22}$/);

    const callbackResponse = responseRecorder();
    await routes.get('/auth/callback')({
        body: {
            v: 1,
            id: 'A'.repeat(22),
            method: 'login',
            ok: true,
            result: signedLogin(XChainSDK, nonceResponse.body.nonce),
        },
    }, callbackResponse);

    assert.equal(callbackResponse.statusCode, 200);
    assert.equal(callbackResponse.body.accepted, true);
    assert.equal(callbackResponse.body.status, 'approved');
    assert.equal(callbackResponse.body.claimed, true);
});
