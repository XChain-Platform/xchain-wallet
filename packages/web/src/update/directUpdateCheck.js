// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Update notice for direct-APK installs (§6, D4 decided 2026-07-31).
//
// Play installs update themselves. A direct install has no such path, so
// without this a user who sideloaded the APK - deliberately, because they
// did not want Google in the loop - would learn about a security fix only if
// they happened to look at the website. This is the only channel they have.
//
// THE FEED IS UNTRUSTED INPUT INTO A WALLET UI, and the design follows from
// that one sentence:
//
//   - The schema is EXACTLY ONE strictly-validated semver field. Not a
//     message, not a URL, not a severity, not a "minimum supported version".
//     Anything else would be attacker-controlled text or an
//     attacker-controlled destination rendered inside a wallet, which is how
//     an update notice becomes a phishing surface.
//   - ALL notice text is composed here, from the version number alone.
//     Nothing from the feed is ever rendered.
//   - It is a NOTICE. It never downloads, never installs, never links
//     anywhere the app did not already know about, and carries no
//     remote-config or kill-switch semantics: a compromised feed can make
//     the app say a version exists, and that is the entire blast radius.
//   - It runs at most daily and the user can switch it off. A wallet that
//     phones home on every launch is a wallet that reports its user's
//     activity pattern to its own servers.
//
// The endpoint is on the §5 wire-audit list, which the Play Data safety
// answers are derived from. It is a static file: no query string, no
// identifiers, no headers we control beyond the request itself.

const FEED_URL = 'https://downloads.xchain.io/wallet/android/latest.json';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PREF_KEY = 'xchain-wallet:update-check';
const MAX_FEED_BYTES = 4096;

/** Strict: three numeric parts, no leading zeros, no pre-release, no build. */
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export class UpdateFeedError extends Error {
    constructor(message) {
        super(`update feed: ${message}`);
        this.name = 'UpdateFeedError';
    }
}

/**
 * Validate a feed body. The ONLY field read is `version`.
 *
 * Unknown fields are ignored rather than rejected, so the feed can carry a
 * comment for a human without breaking older installs - but they are ignored
 * completely, never surfaced. A stricter reading (reject unknown keys) would
 * let anyone who can write the feed break every old client at will, which is
 * the same kill-switch this design refuses to build.
 *
 * @param {unknown} body
 * @returns {string} the validated version
 */
export function parseUpdateFeed(body) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new UpdateFeedError('body must be a JSON object');
    }
    const version = /** @type {any} */ (body).version;
    if (typeof version !== 'string') {
        throw new UpdateFeedError('missing a string "version"');
    }
    if (!SEMVER_RE.test(version)) {
        throw new UpdateFeedError(`"${String(version).slice(0, 32)}" is not a plain MAJOR.MINOR.PATCH`);
    }
    return version;
}

/**
 * Is `candidate` newer than `current`? Numeric comparison, field by field.
 *
 * @param {string} candidate
 * @param {string} current
 * @returns {boolean}
 */
export function isNewerVersion(candidate, current) {
    const a = SEMVER_RE.exec(candidate);
    const b = SEMVER_RE.exec(current);
    if (!a || !b) return false;
    for (let i = 1; i <= 3; i += 1) {
        const x = Number(a[i]);
        const y = Number(b[i]);
        if (x !== y) return x > y;
    }
    return false;
}

/**
 * The user-facing text. Composed here, from the version alone.
 *
 * @param {string} version
 * @returns {string}
 */
export function updateNoticeText(version) {
    return [
        `XChain Wallet ${version} is available.`,
        'You installed this app directly, so it does not update itself.',
        'Download the new version from the same place you got this one, and',
        'check its fingerprint before installing.',
    ].join(' ');
}

/**
 * Run a check.
 *
 * Returns null for every "nothing to say" case, including every failure:
 * the network being down, the feed being malformed, the check being
 * disabled or too recent. A failed update check is not something to
 * interrupt someone's wallet with.
 *
 * @param {object} opts
 * @param {string} opts.currentVersion
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {Storage} [opts.storage]
 * @param {number} [opts.now]
 * @param {boolean} [opts.force]        skip the interval, not the opt-out
 * @returns {Promise<{ version: string, notice: string } | null>}
 */
export async function checkForDirectUpdate(opts) {
    const {
        currentVersion,
        fetchImpl = globalThis.fetch,
        storage = safeStorage(),
        now = Date.now(),
        force = false,
    } = opts || {};

    if (typeof currentVersion !== 'string' || !SEMVER_RE.test(currentVersion)) return null;
    if (typeof fetchImpl !== 'function') return null;

    const prefs = readPrefs(storage);
    if (prefs.enabled === false) return null;
    if (!force && prefs.lastCheck && now - prefs.lastCheck < CHECK_INTERVAL_MS) return null;

    // Stamp BEFORE the request, not after. A feed that hangs or fails must
    // not leave the app retrying on every launch: that turns an outage into
    // a beacon that reports how often the user opens their wallet.
    writePrefs(storage, { ...prefs, lastCheck: now });

    let version;
    try {
        const response = await fetchImpl(FEED_URL, {
            method: 'GET',
            cache: 'no-store',
            redirect: 'error',      // a redirect off our origin is not our feed
            credentials: 'omit',    // nothing about this request identifies anyone
        });
        if (!response?.ok) return null;
        const text = await response.text();
        if (typeof text !== 'string' || text.length > MAX_FEED_BYTES) return null;
        version = parseUpdateFeed(JSON.parse(text));
    } catch (_err) {
        // Offline, DNS failure, malformed JSON, a schema violation: all the
        // same to the user, and none of them is worth a dialog.
        return null;
    }

    if (!isNewerVersion(version, currentVersion)) return null;
    return { version, notice: updateNoticeText(version) };
}

/** Turn the check on or off. Off is remembered; there is no re-prompt. */
export function setUpdateCheckEnabled(enabled, storage = safeStorage()) {
    const prefs = readPrefs(storage);
    writePrefs(storage, { ...prefs, enabled: Boolean(enabled) });
}

/** @returns {boolean} */
export function isUpdateCheckEnabled(storage = safeStorage()) {
    return readPrefs(storage).enabled !== false;
}

export const UPDATE_FEED_URL = FEED_URL;
export const UPDATE_CHECK_INTERVAL_MS = CHECK_INTERVAL_MS;
// Exported for the §7.5 direct-lane rehearsal. An oversized feed
// makes this module return null, which a phone cannot tell apart from being
// offline; the rehearsal has to be able to, so it needs the cap rather than
// a second copy of the number.
export const UPDATE_FEED_MAX_BYTES = MAX_FEED_BYTES;

function safeStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch (_err) {
        return null;
    }
}

function readPrefs(storage) {
    if (!storage) return {};
    try {
        const raw = storage.getItem(PREF_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (_err) {
        return {};
    }
}

function writePrefs(storage, prefs) {
    if (!storage) return;
    try {
        storage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch (_err) {
        // Private mode, quota, a locked-down WebView: the check degrades to
        // once per launch, which is the harmless direction to fail in.
    }
}
