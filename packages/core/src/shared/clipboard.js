// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SSC-4 clipboard hygiene keeps every wallet copy on one path. Native shells
// use the local, sensitivity-marked plugin path. Web, desktop, and extension
// copies use browser APIs. Sensitive writes on every path share the selected
// expiry and compare the current value before clearing it.

import { CLIPBOARD_AUTO_CLEAR_DEFAULT, CLIPBOARD_AUTO_CLEAR_MAX } from '../schemas/settings.js';
import { getNativePlugin, isNativeShell } from './nativeShell.js';

/** The plugin name registered natively (`jsName` / `@CapacitorPlugin(name=)`). */
export const CLIPBOARD_PLUGIN_NAME = 'XChainClipboard';

/**
 * Default lifetime for a sensitive clip, in seconds.
 */
export const SENSITIVE_CLIP_TTL_SECONDS = CLIPBOARD_AUTO_CLEAR_DEFAULT;

let sensitiveAutoClearSeconds = SENSITIVE_CLIP_TTL_SECONDS;
let copyGeneration = 0;
let pendingAutoClear = null;

/**
 * Apply the active wallet's clipboard retention preference.
 * Invalid or missing stored values use the schema default.
 *
 * @param {unknown} seconds
 * @returns {number}
 */
export function configureClipboardAutoClear(seconds) {
    sensitiveAutoClearSeconds = Number.isInteger(seconds)
        && seconds >= 0
        && seconds <= CLIPBOARD_AUTO_CLEAR_MAX
        ? seconds
        : SENSITIVE_CLIP_TTL_SECONDS;
    return sensitiveAutoClearSeconds;
}

/** Why a copy failed, when it did. */
export const CopyFailure = Object.freeze({
    /** Native shell, no clipboard plugin: refusing to leak via the web API. */
    NO_NATIVE_CLIPBOARD: 'NO_NATIVE_CLIPBOARD',
    /** Every available write path threw or is absent. */
    UNAVAILABLE: 'UNAVAILABLE',
});

/**
 * The clipboard plugin handle, or null.
 * @param {any} [env]
 * @returns {Record<string, Function> | null}
 */
export function getNativeClipboard(env = globalThis) {
    return getNativePlugin(CLIPBOARD_PLUGIN_NAME, { env, method: 'write' });
}

/**
 * Can this build copy something sensitive WITHOUT leaking it?
 *
 * True in a browser (nothing to leak to: no cross-device pasteboard sync we
 * could be responsible for, and no API to mark sensitivity with either), true
 * on a native shell whose plugin registered, false on a native shell without
 * one. Callers use it to hide a copy affordance instead of offering a button
 * that can only fail.
 *
 * @param {any} [env]
 * @returns {boolean}
 */
export function sensitiveCopySupported(env = globalThis) {
    if (!isNativeShell(env)) return true;
    return getNativeClipboard(env) !== null;
}

/**
 * Copy `value`, marking it sensitive when it is.
 *
 * @param {string} value
 * @param {{ sensitive?: boolean, ttlSeconds?: number, env?: any }} [opts]
 * @returns {Promise<{ ok: boolean, native: boolean, reason?: string }>}
 */
export async function copyText(value, opts = {}) {
    const {
        sensitive = false,
        ttlSeconds = sensitiveAutoClearSeconds,
        env = globalThis,
    } = opts;
    const text = String(value ?? '');
    const generation = ++copyGeneration;
    cancelPendingAutoClear();

    const plugin = getNativeClipboard(env);
    if (plugin) {
        try {
            // The whole JS -> native surface: a string and two numbers/booleans.
            // No path, no URL, no class name, per SSC-1.
            const res = await plugin.write({ value: text, sensitive, ttlSeconds });
            // `marked` is the native side reporting whether the sensitivity
            // mark was actually APPLIED, not merely requested: Android's
            // EXTRA_IS_SENSITIVE is 13+, so an Android 12 device answers false.
            // Passed through rather than swallowed, because a caller that wants
            // to be honest about the guarantee needs to know, and a copy that
            // silently gave less than it promised is the shape of bug this
            // whole contract exists to remove.
            if (sensitive) scheduleAutoClear(text, ttlSeconds, env, generation);
            return { ok: true, native: true, marked: res?.marked !== false };
        } catch {
            // A native write that THREW is not a reason to try the web path
            // with a secret: the failure says nothing about whether the
            // pasteboard is device-local, so treat it as a refusal.
            if (sensitive) {
                return { ok: false, native: true, reason: CopyFailure.UNAVAILABLE };
            }
        }
    } else if (sensitive && isNativeShell(env)) {
        return { ok: false, native: true, reason: CopyFailure.NO_NATIVE_CLIPBOARD };
    }

    if (await writeViaWebApis(text, env)) {
        if (sensitive) scheduleAutoClear(text, ttlSeconds, env, generation);
        return { ok: true, native: false };
    }
    return { ok: false, native: false, reason: CopyFailure.UNAVAILABLE };
}

/**
 * Clear the clipboard, optionally only when it still holds `expectedValue`.
 *
 * @param {{ env?: any, expectedValue?: string }} [opts]
 * @returns {Promise<boolean>}
 */
export async function clearClipboard(opts = {}) {
    const { env = globalThis, expectedValue } = opts;
    const plugin = getNativeClipboard(env);
    if (plugin && typeof plugin.clear === 'function') {
        try {
            const res = await plugin.clear(expectedValue === undefined ? {} : { expectedValue });
            return res?.cleared !== false;
        } catch { /* fall through: leaving a secret there is the worse outcome */ }
    }
    if (expectedValue !== undefined) {
        const readText = env?.navigator?.clipboard?.readText;
        if (typeof readText !== 'function') return false;
        try {
            if (await readText.call(env.navigator.clipboard) !== expectedValue) return false;
        } catch {
            return false;
        }
    }
    // A single space rather than an empty string: some browsers treat writing
    // '' as a no-op, which would leave the secret in place.
    return writeViaWebApis(' ', env);
}

function cancelPendingAutoClear() {
    if (!pendingAutoClear) return;
    pendingAutoClear.cancel(pendingAutoClear.id);
    pendingAutoClear = null;
}

function scheduleAutoClear(value, seconds, env, generation) {
    if (!Number.isFinite(seconds) || seconds <= 0 || generation !== copyGeneration) return;
    const schedule = typeof env?.setTimeout === 'function'
        ? env.setTimeout.bind(env)
        : setTimeout;
    const cancel = typeof env?.clearTimeout === 'function'
        ? env.clearTimeout.bind(env)
        : clearTimeout;
    const id = schedule(async () => {
        if (generation !== copyGeneration) return;
        pendingAutoClear = null;
        await clearClipboard({ env, expectedValue: value });
    }, seconds * 1000);
    pendingAutoClear = { id, cancel };
}

/**
 * The pre-existing two-tier web write, unchanged in behaviour.
 *
 * Tier 1 `navigator.clipboard.writeText` (secure contexts only); tier 2 a
 * hidden textarea + `document.execCommand('copy')`, which is deprecated and is
 * still the only path that works when the wallet is opened from a plain-HTTP
 * origin or straight off disk.
 *
 * @param {string} text
 * @param {any} env
 * @returns {Promise<boolean>}
 */
async function writeViaWebApis(text, env = globalThis) {
    const nav = env?.navigator;
    if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
        try {
            await nav.clipboard.writeText(text);
            return true;
        } catch { /* fall through to the legacy path */ }
    }
    const doc = env?.document;
    if (!doc || typeof doc.createElement !== 'function') return false;
    try {
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        doc.body.appendChild(ta);
        ta.select();
        const ok = doc.execCommand ? doc.execCommand('copy') : false;
        doc.body.removeChild(ta);
        return Boolean(ok);
    } catch {
        return false;
    }
}
