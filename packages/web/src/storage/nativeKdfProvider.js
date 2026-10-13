// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Native Argon2id for the mobile shells: hands core's wallet key derivation
// to XChainVault.argon2id, which computes the same bytes off the UI thread in
// a fraction of the WebView's JavaScript time. Same parameters, same keys.
//
// Registered only when this bundle runs inside the native shell with its
// vault plugin; a browser, the desktop app and the extension never register
// it. Core falls back to its JS implementation on any rejection, including
// an older shell build that has no `argon2id` method.

import { crypto as coreCrypto } from '@xchain-wallet/core';
import { callNativeVault, hasNativeVault } from './nativeVault.js';

/**
 * One derivation through the plugin. Resolves the base64 key core expects;
 * rejects on anything else so core takes its JS path.
 *
 * @param {{ password: string, salt: string, iterations: number, memoryKib: number, parallelism: number, length: number }} request
 * @returns {Promise<string>}
 */
export async function nativeArgon2id(request) {
    const reply = await callNativeVault('argon2id', {
        password: request.password,
        salt: request.salt,
        iterations: request.iterations,
        memoryKib: request.memoryKib,
        parallelism: request.parallelism,
        length: request.length,
    });
    if (typeof reply?.key !== 'string') {
        throw new Error('XChainVault.argon2id returned no key');
    }
    return reply.key;
}

/**
 * Register the native Argon2id with core when this is the native shell.
 * Safe to call on every boot: core remembers its known-answer verdict per
 * function, so re-registering the same one costs nothing.
 *
 * @returns {boolean} true when the provider was registered
 */
export function installNativeKdfProvider() {
    if (!hasNativeVault()) return false;
    coreCrypto.setNativeArgon2id(nativeArgon2id);
    return true;
}
