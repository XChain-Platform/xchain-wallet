// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The `XChainVault` native-plugin contract ( §1, stage S2), and the
// runtime detection that decides whether this device has one.
//
// WHY THIS FILE LIVES IN THE WEB SHELL. The mobile shell ships no JavaScript
// of its own: `packages/mobile` stages `packages/web/dist` verbatim into its
// Capacitor webDir, deliberately, so the two shells cannot ship different
// bundles (spec §1, and packages/mobile/README.md). Native-shell code that
// has to run inside the SPA therefore has to BE in the SPA's bundle. The
// alternative - packages/web importing packages/mobile - is a workspace
// dependency cycle, since mobile already depends on web for the build order.
//
// It is written to be shell-agnostic on purpose: the same plugin name and
// the same method contract are what 's iOS shell implements over the
// Keychain, so this file is the one place the two native shells agree.
//
// The plugin is reached through the `Capacitor` global rather than by
// importing `@capacitor/core`. That keeps the browser build free of a
// dependency it can never use, and it keeps this module honest: the wallet
// running at wallet.xchain.io genuinely has no native vault, and this code
// says so by finding no global.
//
// EVERY reply is a status, never a bare value. `load` in particular must be
// able to say LOCKED or CORRUPT, because the caller turns a null into the
// create-a-new-wallet screen (see core's VaultUnavailableError family).

import { storage as coreStorage, crypto as coreCrypto } from '@xchain-wallet/core';

const { VaultLockedError, VaultCorruptError, VaultUnavailableError } = coreStorage;
const { bytesToBase64, base64ToBytes } = coreCrypto;

/** The plugin name registered natively (`@CapacitorPlugin(name = ...)`). */
export const PLUGIN_NAME = 'XChainVault';

/** Statuses the native side may return from a read. */
export const VaultStatus = Object.freeze({
    OK: 'OK',
    ABSENT: 'ABSENT',
    LOCKED: 'LOCKED',
    CORRUPT: 'CORRUPT',
});

/**
 * The plugin handle, or null when this is an ordinary browser.
 *
 * Injectable for tests via `__setNativeVaultForTests`; production reads the
 * Capacitor global, which the native runtime installs before the SPA loads.
 *
 * @returns {Record<string, Function> | null}
 */
export function getNativeVault() {
    if (injectedForTests !== undefined) return injectedForTests;
    const cap = /** @type {any} */ (globalThis).Capacitor;
    if (!cap) return null;
    // `isNativePlatform` is a function on the real Capacitor global. A browser
    // page that merely defines `window.Capacitor` (some dApp libraries do)
    // must not be mistaken for a native shell.
    if (typeof cap.isNativePlatform === 'function' && !cap.isNativePlatform()) return null;
    const plugin = cap.Plugins?.[PLUGIN_NAME];
    return plugin && typeof plugin.loadVault === 'function' ? plugin : null;
}

/** @returns {boolean} true when a native vault plugin is present. */
export function hasNativeVault() {
    return getNativeVault() !== null;
}

/**
 * Is this the SHELL, regardless of whether its plugin loaded?
 *
 * Deliberately a separate question from `hasNativeVault()`. Those two used to
 * be one, and the missing distinction is : a native build whose plugin
 * failed to register answered "no native vault", which reads identically to a
 * browser, so the wallet quietly stored the only copy of the vault in the
 * WebView storage the whole native-vault stage exists to escape. Silent, on a
 * build whose backup posture guarantees there is no second copy.
 *
 * The registration is easy to lose on both shells - iOS needs an explicit
 * `bridge?.registerPluginInstance` in `capacitorDidLoad` (an app-local plugin
 * never appears in Capacitor's `packageClassList`), Android a `registerPlugin`
 * line in the Activity - and the iOS twin actually lost it once, in the hour
 * between this failure mode being registered as hypothetical and being found
 * live in our own code.
 *
 * @param {any} [env]  injectable globals for tests
 * @returns {boolean}
 */
export function isNativeShell(env = globalThis) {
    if (injectedShellForTests !== undefined) return injectedShellForTests;
    const cap = /** @type {any} */ (env)?.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function') return false;
    return cap.isNativePlatform() === true;
}

/**
 * The state no code may treat as "browser": a native shell with no vault.
 *
 * There is no correct fallback here. IndexedDB on a native shell is not a
 * lesser vault, it is a vault the OS may reclaim and the user may clear from
 * Settings, with no seed backup behind it because `allowBackup=false` and the
 * iOS backup exclusion are deliberate. So this is a BROKEN BUILD, and callers
 * refuse rather than degrade.
 *
 * @param {any} [env]
 * @returns {boolean}
 */
export function nativeShellIsBroken(env = globalThis) {
    return isNativeShell(env) && !hasNativeVault();
}

/** Plain-language explanation, shared by the boot screen and the thrown error. */
export const BROKEN_SHELL_MESSAGE = [
    'This copy of XChain Wallet is missing the part that stores your wallet safely'
    + ` on this device (the ${PLUGIN_NAME} plugin did not load).`,
    'That normally means the app was built or installed incorrectly.',
    'The wallet will not open, because the only alternative is keeping your keys'
    + ' somewhere the system can erase without warning.',
    'Reinstall from an official source. Your recovery phrase is unaffected and can'
    + ' be imported into any working install.',
].join(' ');

/** @type {Record<string, Function> | null | undefined} */
let injectedForTests;

/** @type {boolean | undefined} */
let injectedShellForTests;

/**
 * Test seam. `undefined` restores real detection; `null` forces "browser".
 * @param {Record<string, Function> | null | undefined} plugin
 */
export function __setNativeVaultForTests(plugin) {
    injectedForTests = plugin;
}

/**
 * Test seam for the PLATFORM half, which is what makes the broken-build state
 * reachable in a test: native shell, no plugin.
 * @param {boolean | undefined} isNative
 */
export function __setNativeShellForTests(isNative) {
    injectedShellForTests = isNative;
}

/**
 * Turn a native read reply into bytes, absence, or the right typed error.
 *
 * The default branch matters as much as the named ones: an unrecognized
 * status is NOT absence. A future native version that grows a fifth status,
 * or a plugin that returns something malformed, must fail loudly rather than
 * report "this device has no wallet".
 *
 * @param {{ status?: string, blob?: string, detail?: string } | null | undefined} reply
 * @param {string} what   for the error message ('vault' | 'meta')
 * @returns {Uint8Array | null}
 */
export function decodeReadReply(reply, what = 'vault') {
    const status = reply?.status;
    switch (status) {
        case VaultStatus.ABSENT:
            return null;
        case VaultStatus.OK: {
            if (typeof reply.blob !== 'string') {
                throw new VaultCorruptError(`native ${what} returned OK with no payload`);
            }
            return base64ToBytes(reply.blob);
        }
        case VaultStatus.LOCKED:
            throw new VaultLockedError(reply.detail || `native ${what} is locked`);
        case VaultStatus.CORRUPT:
            throw new VaultCorruptError(reply.detail || `native ${what} failed to decrypt`);
        default:
            throw new VaultUnavailableError(
                `native ${what} returned an unusable status ${JSON.stringify(status)}`,
            );
    }
}

/**
 * Call a plugin method, normalizing a rejected native call into the same
 * typed-error family. A native exception (binder death, plugin missing on an
 * older build) is "unavailable", never "absent".
 *
 * @param {string} method
 * @param {object} [args]
 * @returns {Promise<any>}
 */
export async function callNativeVault(method, args = {}) {
    const plugin = getNativeVault();
    if (!plugin) {
        throw new VaultUnavailableError(`${PLUGIN_NAME}.${method}: no native vault on this platform`);
    }
    if (typeof plugin[method] !== 'function') {
        throw new VaultUnavailableError(
            `${PLUGIN_NAME}.${method}: this shell build does not implement it`,
        );
    }
    try {
        return await plugin[method](args);
    } catch (err) {
        // Preserve an already-typed error thrown by a test double.
        if (err instanceof VaultUnavailableError) throw err;
        throw new VaultUnavailableError(
            `${PLUGIN_NAME}.${method} failed: ${err?.message || String(err)}`,
        );
    }
}

/**
 * Byte-array check that survives realm boundaries.
 *
 * `x instanceof Uint8Array` is false for an array produced in a different
 * realm, and this code sits on exactly such a boundary: TextEncoder output,
 * values handed back across the Capacitor bridge, and anything that arrives
 * through an iframe or a test environment's DOM globals can all be genuine
 * byte arrays that fail the instanceof check. Refusing them would reject a
 * perfectly good vault payload.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBytes(value) {
    return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

/** @param {Uint8Array} bytes */
export function encodePayload(bytes) {
    if (!isBytes(bytes)) {
        throw new Error('nativeVault: payload must be a Uint8Array');
    }
    return bytesToBase64(bytes);
}
