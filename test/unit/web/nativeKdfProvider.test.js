// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The web shell registers XChainVault.argon2id with core only inside the
// native shell, and a plugin without the method (or one that rejects) leaves
// every derivation on the JS path with the same key.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { argon2id } from '@noble/hashes/argon2';

import { crypto as coreCrypto } from '@xchain-wallet/core';
import {
    __setNativeVaultForTests,
    __setNativeShellForTests,
} from '../../../packages/web/src/storage/nativeVault.js';
import {
    installNativeKdfProvider,
    nativeArgon2id,
} from '../../../packages/web/src/storage/nativeKdfProvider.js';
import vectorFile from '../../fixtures/crypto/argon2id-vectors.json';

const { deriveMasterKeyAsync, hasNativeArgon2id, setNativeArgon2id, bytesToBase64, base64ToBytes } = coreCrypto;

const SMALL = vectorFile.vectors.find((v) => v.memoryKib === 8192);
const PARAMS = {
    algorithm: 'argon2id',
    salt: SMALL.salt,
    iterations: SMALL.iterations,
    memory: SMALL.memoryKib,
    parallelism: SMALL.parallelism,
};
const hex = (bytes) => Buffer.from(bytes).toString('hex');

/** A plugin double whose argon2id follows the native contract. */
function pluginWith(argon2idImpl) {
    const plugin = { loadVault: vi.fn(async () => ({ status: 'ABSENT' })) };
    if (argon2idImpl) plugin.argon2id = vi.fn(argon2idImpl);
    return plugin;
}

function mockNativeCapacitor(plugin) {
    globalThis.Capacitor = {
        isNativePlatform: () => true,
        Plugins: { XChainVault: plugin },
    };
}

async function contractArgon2id(opts) {
    const key = argon2id(new TextEncoder().encode(opts.password), base64ToBytes(opts.salt), {
        t: opts.iterations, m: opts.memoryKib, p: opts.parallelism, dkLen: opts.length,
    });
    return { key: bytesToBase64(key) };
}

afterEach(() => {
    __setNativeVaultForTests(undefined);
    __setNativeShellForTests(undefined);
    setNativeArgon2id(null);
    delete globalThis.Capacitor;
});

describe('installNativeKdfProvider', () => {
    it('does not register in a browser, the desktop app or the extension (no native vault)', () => {
        __setNativeVaultForTests(null);
        expect(installNativeKdfProvider()).toBe(false);
        expect(hasNativeArgon2id()).toBe(false);
    });

    it('does not register from a page that merely defines a Capacitor global', () => {
        const saved = globalThis.Capacitor;
        globalThis.Capacitor = { isNativePlatform: () => false, Plugins: { XChainVault: pluginWith(contractArgon2id) } };
        try {
            expect(installNativeKdfProvider()).toBe(false);
            expect(hasNativeArgon2id()).toBe(false);
        } finally {
            globalThis.Capacitor = saved;
        }
    });

    it('registers in the native shell and derives through the plugin', async () => {
        const plugin = pluginWith(contractArgon2id);
        mockNativeCapacitor(plugin);
        expect(installNativeKdfProvider()).toBe(true);
        expect(hasNativeArgon2id()).toBe(true);

        const key = await deriveMasterKeyAsync(SMALL.password, PARAMS);
        expect(hex(key)).toBe(SMALL.keyHex);
        // Known-answer check, then the wallet derivation, with contract options.
        expect(plugin.argon2id).toHaveBeenCalledTimes(2);
        expect(plugin.argon2id.mock.calls[1][0]).toEqual({
            password: SMALL.password,
            salt: SMALL.salt,
            iterations: SMALL.iterations,
            memoryKib: SMALL.memoryKib,
            parallelism: SMALL.parallelism,
            length: 32,
        });
    });

    it('falls back silently when the shell build has no argon2id method', async () => {
        mockNativeCapacitor(pluginWith(null));
        expect(installNativeKdfProvider()).toBe(true);
        expect(hex(await deriveMasterKeyAsync(SMALL.password, PARAMS))).toBe(SMALL.keyHex);
    });

    it('falls back silently when the plugin rejects', async () => {
        const plugin = pluginWith(async () => { throw new Error('OutOfMemoryError'); });
        __setNativeVaultForTests(plugin);
        installNativeKdfProvider();
        expect(hex(await deriveMasterKeyAsync(SMALL.password, PARAMS))).toBe(SMALL.keyHex);
        expect(plugin.argon2id).toHaveBeenCalledTimes(1);
    });

    it('falls back to JS and quarantines a plugin that fails the known-answer check', async () => {
        const wrongKey = bytesToBase64(new Uint8Array(32).fill(0x7f));
        const plugin = pluginWith(async () => ({ key: wrongKey }));
        mockNativeCapacitor(plugin);
        expect(installNativeKdfProvider()).toBe(true);

        expect(hex(await deriveMasterKeyAsync(SMALL.password, PARAMS))).toBe(SMALL.keyHex);
        expect(hex(await deriveMasterKeyAsync(SMALL.password, PARAMS))).toBe(SMALL.keyHex);
        expect(plugin.argon2id).toHaveBeenCalledTimes(1);
        expect(plugin.argon2id.mock.calls[0][0].password).not.toBe(SMALL.password);
    });

    it('turns a reply without a key into a rejection core can fall back from', async () => {
        __setNativeVaultForTests(pluginWith(async () => ({})));
        await expect(nativeArgon2id({
            password: 'p', salt: SMALL.salt, iterations: 1, memoryKib: 8192, parallelism: 1, length: 32,
        })).rejects.toThrow(/no key/);
    });
});
