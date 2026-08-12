// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Runtime capability floor for the WebView the wallet is running in
// (§3).
//
// TWO TIERS, because the two failure modes deserve different answers:
//
//   HARD FAIL - a primitive the wallet cannot work without is missing.
//   `crypto.subtle` is the KDF and the AEAD; `getRandomValues` is every key
//   and nonce; IndexedDB is the web-shell vault. A wallet that boots without
//   one of these does not degrade gracefully, it does something worse: it
//   gets far enough to ask for a password and then fails somewhere the user
//   reads as "my wallet is broken" rather than "this device cannot run it".
//   Worst case, a missing `getRandomValues` with a fallback behind it
//   generates a key from something predictable. There is no safe fallback,
//   so there is no fallback.
//
//   SOFT WARN - the primitives are all there but the engine is old enough
//   that we would rather the user updated. This is advice, not a gate:
//   refusing to open a wallet over a version string would strand people who
//   can still perfectly well move their own coins.
//
// The distinction matters most on exactly the devices §3 names: the direct-
// APK audience skews toward de-Googled ROMs where the System WebView ships
// with the OS instead of being updated by Play, so "old but capable" is a
// real, common, and entirely usable state - not a bug to block on.

/** Chromium version below which we advise an update (soft). */
export const SOFT_MIN_CHROMIUM = 108;

/**
 * @typedef {Object} FloorReport
 * @property {boolean} usable        false = hard fail, do not boot the wallet
 * @property {string[]} missing      names of absent required primitives
 * @property {boolean} stale         true = old-but-capable engine
 * @property {number|null} chromium  detected major version, null if unknown
 */

/**
 * Probe the current environment.
 *
 * Feature DETECTION for the hard tier, not version sniffing: a fork, a new
 * engine, or a WebView that ships a primitive early should all be judged on
 * whether the primitive is there. Version only decides the soft warning.
 *
 * @param {object} [env]  injectable globals for tests
 * @returns {FloorReport}
 */
export function checkWebViewFloor(env = globalThis) {
    const missing = [];

    const subtle = env?.crypto?.subtle;
    // Presence AND callability: some embedded engines expose a `subtle`
    // object whose methods are absent, which passes a truthiness check and
    // then throws at the first derive.
    if (!subtle || typeof subtle.importKey !== 'function' || typeof subtle.encrypt !== 'function') {
        missing.push('crypto.subtle');
    }
    if (typeof env?.crypto?.getRandomValues !== 'function') {
        missing.push('crypto.getRandomValues');
    }
    if (!env?.indexedDB || typeof env.indexedDB.open !== 'function') {
        missing.push('indexedDB');
    }
    if (typeof env?.TextEncoder !== 'function' || typeof env?.TextDecoder !== 'function') {
        missing.push('TextEncoder/TextDecoder');
    }
    if (typeof env?.BigInt !== 'function') {
        // Every amount in this wallet is an integer of satoshis; without
        // BigInt the arithmetic silently loses precision rather than failing.
        missing.push('BigInt');
    }

    const chromium = detectChromiumMajor(env?.navigator?.userAgent);

    return {
        usable: missing.length === 0,
        missing,
        stale: missing.length === 0 && chromium !== null && chromium < SOFT_MIN_CHROMIUM,
        chromium,
    };
}

/**
 * The major Chromium version, or null when it cannot be read.
 *
 * Null is not a failure: an unrecognized user agent means we do not warn,
 * because guessing "old" from an unfamiliar string would nag every user of
 * every engine we have not heard of.
 *
 * @param {unknown} userAgent
 * @returns {number|null}
 */
export function detectChromiumMajor(userAgent) {
    if (typeof userAgent !== 'string') return null;
    const m = /Chrome\/(\d+)\./.exec(userAgent);
    if (!m) return null;
    const major = Number(m[1]);
    return Number.isInteger(major) && major > 0 ? major : null;
}

/**
 * Plain-language message for a hard failure.
 *
 * Names what is missing and what to do about it. "Your browser is
 * unsupported" tells a user nothing they can act on, and this screen is the
 * only thing they will ever see from the app.
 *
 * @param {FloorReport} report
 * @returns {string}
 */
export function floorFailureMessage(report) {
    const list = report.missing.join(', ');
    return [
        'XChain Wallet cannot run safely on this device.',
        `The browser engine here is missing: ${list}.`,
        'These are the parts that encrypt your wallet and generate your keys.',
        'Updating Android System WebView (or your system browser) usually fixes it.',
        'Your recovery phrase is unaffected: it can be imported on any device that does support them.',
    ].join(' ');
}

/**
 * Plain-language message for the soft warning.
 *
 * @param {FloorReport} report
 * @returns {string}
 */
export function floorStaleMessage(report) {
    return [
        `This device's browser engine (Chromium ${report.chromium}) is out of date.`,
        'The wallet works, but updating Android System WebView is recommended:',
        'security fixes for the engine that handles your wallet arrive that way.',
    ].join(' ');
}
