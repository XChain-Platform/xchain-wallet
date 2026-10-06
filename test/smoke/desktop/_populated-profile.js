// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { webcrypto } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    registry as registryLib,
    sdk as sdkLib,
} from '../../../packages/core/src/index.js';
import { createDevMockSdk } from '../../../packages/extension/src/background/sdkFactory.js';
import { XChainSDK } from '../../../packages/extension/src/background/sdkStatic.js';
import {
    KeychainSessionBackend,
    sessionKeyPathFor,
} from '../../../packages/desktop/main/keychain.js';
import {
    FileMetaBackend,
    metaPathFor,
} from '../../../packages/desktop/main/meta.js';
import {
    createRuntime,
    handleIpcMessage,
    tearDownHost,
} from '../../../packages/desktop/main/runtime.js';
import {
    FileStorageBackend,
    vaultPathFor,
} from '../../../packages/desktop/main/storage.js';
import {
    FileUnlockThrottleStore,
    unlockThrottlePathFor,
} from '../../../packages/desktop/main/unlockThrottle.js';

export const PROFILE_PASSWORD = 'fixture-password';
export const PROFILE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const PROFILE_NATIVE_CONFIRMED = '0.12345678';
export const PROFILE_SIGN_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
export const PROFILE_HISTORY_CHAIN_ID = 'bitcoin-regtest';
export const PROFILE_HISTORY_TXID = 'ab'.repeat(32);
export const PROFILE_SETTINGS = {
    theme: 'dark',
    fiatCurrency: 'EUR',
    autolockMinutes: 30,
};

function makeMockSafeStorage() {
    const xorKey = 0x5a;
    return {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'keychain_access',
        encryptString(plain) {
            const bytes = Buffer.from(plain, 'utf8');
            const out = Buffer.alloc(bytes.length);
            for (let i = 0; i < bytes.length; i += 1) out[i] = bytes[i] ^ xorKey;
            return out;
        },
        decryptString(cipher) {
            const bytes = Buffer.isBuffer(cipher) ? cipher : Buffer.from(cipher);
            const out = Buffer.alloc(bytes.length);
            for (let i = 0; i < bytes.length; i += 1) out[i] = bytes[i] ^ xorKey;
            return out.toString('utf8');
        },
    };
}

function resultOrThrow(reply) {
    if (!reply?.ok) {
        throw new Error(reply?.error?.message || 'Desktop profile request failed');
    }
    return reply.result;
}

export function buildProfileRuntime(userDataDir) {
    const chainRegistry = registryLib.defaultRegistry();
    return createRuntime({
        storageBackend: new FileStorageBackend(vaultPathFor(userDataDir)),
        metaBackend: new FileMetaBackend(metaPathFor(userDataDir)),
        sessionBackend: new KeychainSessionBackend({
            safeStorage: makeMockSafeStorage(),
            filePath: sessionKeyPathFor(userDataDir),
        }),
        unlockThrottleStore: new FileUnlockThrottleStore(unlockThrottlePathFor(userDataDir)),
        chainRegistry,
        sdkRegistry: new sdkLib.SDKRegistry({
            chainRegistry,
            sdkFactory: (opts) => ({
                ...createDevMockSdk(opts),
                getBalances: async () => ({ data: [] }),
                getAddress: async () => ({
                    balances: { confirmed: PROFILE_NATIVE_CONFIRMED },
                }),
                auth: sdkLib.adaptXChainSDK(XChainSDK)(opts).auth,
                encoder: {
                    broadcastTx: async () => PROFILE_HISTORY_TXID,
                },
            }),
        }),
    });
}

export async function seedPopulatedProfile(userDataDir) {
    const runtime = buildProfileRuntime(userDataDir);
    const fixtureSecret = PROFILE_PASSWORD;
    try {
        resultOrThrow(await handleIpcMessage(runtime, {
            type: 'wallet.import',
            request: {
                password: fixtureSecret,
                mnemonic: PROFILE_MNEMONIC,
                name: 'Upgrade fixture wallet',
            },
        }));
        resultOrThrow(await handleIpcMessage(runtime, {
            type: 'settings.update',
            request: { patch: PROFILE_SETTINGS },
        }));
        resultOrThrow(await handleIpcMessage(runtime, {
            type: 'broadcast.signedTx',
            request: {
                chainId: PROFILE_HISTORY_CHAIN_ID,
                txHex: '0200000000',
            },
        }));
        resultOrThrow(await handleIpcMessage(runtime, { type: 'wallet.lock' }));
    } finally {
        tearDownHost(runtime);
    }
}

const invokedPath = process.argv[1] && resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
    const userDataDir = process.argv[2];
    if (!userDataDir) throw new Error('Usage: node _populated-profile.js <dir>');
    await seedPopulatedProfile(userDataDir);
}
