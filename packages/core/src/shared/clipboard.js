// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SSC-4, clipboard hygiene: the one path every copy in the wallet goes through
// (; the contract is  §1.1, the iOS mechanics  §4).
//
// WHAT WAS WRONG. The shared UI copied through `navigator.clipboard`, which in
// a WebView writes to the ordinary system pasteboard with no sensitivity
// marking and no expiry. On iOS that means Universal Clipboard, which is ON by
// default: tapping "Copy recovery phrase" put the seed on every nearby Mac and
// iPad signed into the same Apple account, seconds later, silently. On Android
// any foreground app can read the clip, and without
// `ClipDescription.EXTRA_IS_SENSITIVE` the system itself will happily render
// the seed in a paste preview. The 60-second JS auto-clear the seed screen
// already does is not an answer to either: it clears THIS device's clipboard,
// long after the copy has been synced or read elsewhere.
//
// WHAT THIS DOES. A sensitive copy on a native shell goes through the
// `XChainClipboard` plugin, which marks it sensitive, keeps it local to the
// device and gives it a real expiry (iOS `UIPasteboard` `.localOnly` +
// `expirationDate`; Android `EXTRA_IS_SENSITIVE` + a scheduled clear).
//
// AND IT REFUSES RATHER THAN DEGRADES. On a native shell whose clipboard
// plugin did not register, a sensitive copy FAILS. It does not quietly fall
// back to `navigator.clipboard`, because that fallback is the exact leak this
// exists to prevent, and it would be invisible: the copy would appear to work.
// That is 's lesson applied to the second bridge - a native build
// missing its plugin is a broken build, not a lesser one.
//
// A browser is a different case and is treated as one: web, desktop and the
// extension have no sensitivity API to use, so a sensitive copy there behaves
// exactly as it always has, and the caller's own auto-clear stays the mitigation.

import { getNativePlugin, isNativeShell } from './nativeShell.js';

/** The plugin name registered natively (`jsName` / `@CapacitorPlugin(name=)`). */
export const CLIPBOARD_PLUGIN_NAME = 'XChainClipboard';

/**
 * How long a sensitive clip may live, in seconds.
 *
 * 60 matches the auto-clear the seed screen has always done in JS, so the two
 * mechanisms expire together rather than one outliving the other. The native
 * side treats this as an upper bound it enforces itself, which is the half the
 * JS timer could never do: a JS timer dies with the WebView.
 */
export const SENSITIVE_CLIP_TTL_SECONDS = 60;

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
        ttlSeconds = SENSITIVE_CLIP_TTL_SECONDS,
        env = globalThis,
    } = opts;
    const text = String(value ?? '');

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

    return (await writeViaWebApis(text, env))
        ? { ok: true, native: false }
        : { ok: false, native: false, reason: CopyFailure.UNAVAILABLE };
}

/**
 * Clear whatever this app put on the clipboard.
 *
 * The seed and private-key screens have always done this on a timer. On a
 * native shell it now clears the real pasteboard rather than overwriting it
 * with a space, which on iOS would sync a space to every nearby device and
 * leave the seed in the receiving devices' clipboards anyway.
 *
 * Best effort by definition: another app may have taken the pasteboard since.
 *
 * @param {{ env?: any }} [opts]
 * @returns {Promise<boolean>}
 */
export async function clearClipboard(opts = {}) {
    const { env = globalThis } = opts;
    const plugin = getNativeClipboard(env);
    if (plugin && typeof plugin.clear === 'function') {
        try {
            await plugin.clear();
            return true;
        } catch { /* fall through: leaving a secret there is the worse outcome */ }
    }
    // A single space rather than an empty string: some browsers treat writing
    // '' as a no-op, which would leave the secret in place.
    return writeViaWebApis(' ', env);
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
