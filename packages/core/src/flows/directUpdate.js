// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The update-notice seam for shells that have a lane nobody updates for them
// (§6, D4 decided 2026-07-31).
//
// WHY THIS IS A SEAM AND NOT A CALL. Every shell in this repo except one is
// updated by something else: the browser reloads, the extension is updated by
// the Chrome Web Store, the desktop app by electron-updater, the Play install
// by Play, the App Store install by the App Store. Exactly ONE shipped
// artifact has no such path - the direct-download Android APK (§6: "there is
// no halt, no rollback, and no downgrade ... the remedy is a signed advisory
// plus a fixed higher-versionCode build plus the feed notice"). Its users
// sideloaded on purpose, which is precisely why they will not hear about a
// security fix any other way.
//
// The gate cannot be a build flag. §6 derives the universal APK from the SAME
// bundle as the store AAB - one build, two signatures, so the two files are
// provably the same code - and both mobile shells serve the same web bundle as
// each other. So the module that knows the feed exists ships everywhere, and
// what must differ is whether anything ever CALLS it.
//
// Hence: core holds a null provider and knows nothing about any feed. A shell
// installs one only after asking its own native layer which lane installed it.
// An iOS build cannot install one (its plugin has no such method), a browser
// cannot (there is no plugin), and a Play install answers "store". That is the
// whole enforcement, and it is enforced HERE, in the default value of a
// variable, rather than by remembering to check something at four call sites.

/**
 * @typedef {Object} DirectUpdateProvider
 * @property {() => Promise<{ version: string, notice: string } | null>} check
 * @property {() => boolean} isEnabled
 * @property {(enabled: boolean) => void} setEnabled
 * @property {string} [feedUrl]   for the About panel and diagnostics only
 */

/** @type {DirectUpdateProvider | null} */
let installedProvider = null;

/**
 * Install a shell-supplied provider. Call at shell boot, and ONLY after the
 * shell has established that this install has no store keeping it current.
 * Passing null uninstalls (tests, and a shell that re-boots into a browser).
 *
 * @param {DirectUpdateProvider | null} provider
 */
export function setDirectUpdateProvider(provider) {
    if (provider === null) {
        installedProvider = null;
        return;
    }
    for (const method of ['check', 'isEnabled', 'setEnabled']) {
        if (typeof provider?.[method] !== 'function') {
            throw new Error(`setDirectUpdateProvider: provider is missing ${method}()`);
        }
    }
    installedProvider = provider;
}

/**
 * Does this install have to look after its own updates?
 *
 * The UI asks this before it renders anything at all about updating. False
 * everywhere but a directly-installed Android APK.
 *
 * @returns {boolean}
 */
export function hasDirectUpdateLane() {
    return installedProvider !== null;
}

/**
 * Run a check, or resolve null when there is nothing to say.
 *
 * Null covers every quiet case AND every failure: no lane, switched off,
 * checked too recently, offline, malformed feed, already current. A failed
 * update check is not worth interrupting somebody's wallet over.
 *
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ version: string, notice: string } | null>}
 */
export async function checkForUpdateNotice(opts = {}) {
    if (!installedProvider) return null;
    try {
        return (await installedProvider.check(opts)) ?? null;
    } catch (_err) {
        return null;
    }
}

/** @returns {boolean} true when the check is on (and there is a lane at all). */
export function isUpdateNoticeEnabled() {
    if (!installedProvider) return false;
    try {
        return installedProvider.isEnabled() !== false;
    } catch (_err) {
        return false;
    }
}

/**
 * Turn the check off, or back on. Off is remembered and there is no re-prompt:
 * a wallet that keeps asking to phone home is a wallet that phones home.
 *
 * @param {boolean} enabled
 */
export function setUpdateNoticeEnabled(enabled) {
    if (!installedProvider) return;
    try {
        installedProvider.setEnabled(Boolean(enabled));
    } catch (_err) {
        // A storage failure degrades to "on until the app closes", which is
        // the harmless direction: it can only cause an extra check.
    }
}

/** The feed URL, for the About panel and the diagnostic dump. Null off-lane. */
export function directUpdateFeedUrl() {
    return installedProvider?.feedUrl ?? null;
}
