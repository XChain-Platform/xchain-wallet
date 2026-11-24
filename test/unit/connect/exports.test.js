// @vitest-environment node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
    CONNECT_OUTPUT_FILES,
    writeConnectBuild,
} from '../../../packages/connect/scripts/build.mjs';
import walletRequests from '../../../packages/connect/wallet-requests.json';

const require = createRequire(import.meta.url);
const EXPECTED_EXPORTS = [
    'createClient',
    'buildRequest',
    'requestLink',
    'parseRequest',
    'parseReturn',
    'PROTOCOL_VERSION',
    'ERROR_CODES',
    'formatLoginChallenge',
    'parseLoginChallenge',
    'validateLoginChallenge',
];

function assertPublicExports(api) {
    for (const name of EXPECTED_EXPORTS) expect(api[name], name).toBeDefined();
    expect(api.PROTOCOL_VERSION).toBe('0.2.0');
    expect(api.SUPPORTED_PROTOCOL_VERSIONS).toEqual(['0.1.0', '0.2.0']);
    expect(api.BRIDGE_SPEC_VERSION).toBe('0.1.0');
    expect(api.BRIDGE_SUPPORTED_VERSIONS).toEqual(['0.1.0']);
    expect(api.isBridgeVersionSupported('^0.1.0')).toBe(true);
    expect(api.isBridgeVersionSupported('^0.2.0')).toBe(false);
    expect(api.ERROR_CODES).toEqual(walletRequests.errors);
    expect(api.ERROR_CODES.every((code) => api.isErrorCode(code))).toBe(true);
    expect(api.isBridgeErrorCode('REQUEST_EXPIRED')).toBe(false);
    expect(api.LOGIN_CHALLENGE_VERSION).toBe(api.SIGN_IN_CHALLENGE_VERSION);
    expect(api.LOGIN_DEFAULT_EXPIRY_MS).toBe(api.SIGN_IN_DEFAULT_EXPIRY_MS);
    expect(api.LOGIN_CHALLENGE_PREFIX).toBe(api.SIGN_IN_CHALLENGE_PREFIX);
    expect(api.LOGIN_CHALLENGE_SEPARATOR).toBe(api.SIGN_IN_CHALLENGE_SEPARATOR);
    expect(api.formatSignInChallenge).toBe(api.formatLoginChallenge);
    expect(api.parseSignInChallenge).toBe(api.parseLoginChallenge);
    expect(api.validateSignInChallenge).toBe(api.validateLoginChallenge);
}

function installProviderHarness(target, eventName) {
    const properties = ['xchain', 'addEventListener', 'removeEventListener'];
    const originals = new Map(properties.map((name) => [
        name,
        Object.getOwnPropertyDescriptor(target, name),
    ]));
    const listeners = new Map();

    Object.defineProperties(target, {
        addEventListener: {
            configurable: true,
            value(name, listener, options = {}) {
                const entries = listeners.get(name) ?? [];
                entries.push({ listener, once: options.once === true });
                listeners.set(name, entries);
            },
        },
        removeEventListener: {
            configurable: true,
            value(name, listener) {
                const entries = listeners.get(name) ?? [];
                listeners.set(name, entries.filter((entry) => entry.listener !== listener));
            },
        },
    });
    delete target.xchain;

    return {
        inject(provider) {
            target.xchain = provider;
            for (const entry of [...(listeners.get(eventName) ?? [])]) {
                entry.listener();
                if (entry.once) target.removeEventListener(eventName, entry.listener);
            }
        },
        listenerCount() {
            return listeners.get(eventName)?.length ?? 0;
        },
        restore() {
            for (const [name, descriptor] of originals) {
                if (descriptor) Object.defineProperty(target, name, descriptor);
                else delete target[name];
            }
        },
    };
}

async function assertDelayedProviderInjection(api, target) {
    const harness = installProviderHarness(target, api.PROVIDER_READY_EVENT);
    const provider = { isXChainWallet: true, version: api.BRIDGE_SPEC_VERSION };

    try {
        expect(api.isXChainAvailable()).toBe(false);
        const pending = api.getProvider({ timeoutMs: 100 });
        expect(harness.listenerCount()).toBe(1);

        harness.inject(provider);

        await expect(pending).resolves.toBe(provider);
        expect(api.isXChainAvailable()).toBe(true);
        await expect(api.getProvider({ timeoutMs: 0 })).resolves.toBe(provider);
        expect(harness.listenerCount()).toBe(0);
    } finally {
        harness.restore();
    }
}

describe('connect public exports', () => {
    it('writes equivalent ESM, CJS and IIFE builds', async () => {
        const tmpRoot = resolve('tmp');
        await mkdir(tmpRoot, { recursive: true });
        const outdir = await mkdtemp(join(tmpRoot, 'connect-exports-'));

        try {
            const paths = await writeConnectBuild({ outdir });
            expect(paths).toEqual(Object.fromEntries(
                Object.entries(CONNECT_OUTPUT_FILES).map(([format, file]) => [
                    format,
                    join(outdir, file),
                ]),
            ));

            const esm = await import(pathToFileURL(paths.esm).href);
            const cjs = require(paths.cjs);
            const context = vm.createContext({
                clearTimeout,
                setTimeout,
                TextDecoder,
                TextEncoder,
                URL,
                Uint8Array,
            });
            vm.runInContext(await readFile(paths.iife, 'utf8'), context);

            assertPublicExports(esm);
            assertPublicExports(cjs);
            assertPublicExports(context.XChainConnect);

            await assertDelayedProviderInjection(esm, globalThis);
            await assertDelayedProviderInjection(cjs, globalThis);
            await assertDelayedProviderInjection(context.XChainConnect, context);

            expect(await readFile(paths.iife, 'utf8')).not.toContain('import ');
            expect(await readFile(paths.iife, 'utf8')).not.toContain('require(');
        } finally {
            await rm(outdir, { recursive: true, force: true });
        }
    });

    it('keeps the login challenge bytes stable through the new names', async () => {
        const runtime = await import('../../../packages/connect/src/runtime.js');
        const parts = {
            version: 2,
            appId: 'request.example',
            origin: 'https://request.example',
            address: 'bc1qexample',
            nonce: 'nonce',
            timestamp: 1_800_000_000_000,
            expiresAt: 1_800_000_300_000,
        };
        const challenge = [
            'XChain Sign-In v2',
            'request.example',
            'https://request.example',
            'bc1qexample',
            'nonce',
            '1800000000000',
            '1800000300000',
        ].join(' | ');

        expect(runtime.formatLoginChallenge(parts)).toBe(challenge);
        expect(runtime.parseLoginChallenge(challenge)).toEqual(parts);
        expect(runtime.validateLoginChallenge(parts, {
            appId: parts.appId,
            origin: parts.origin,
            nonce: parts.nonce,
            now: parts.timestamp,
        })).toBeNull();
    });
});
