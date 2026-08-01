// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// electron-updater wiring (§40.12 Step 19).
//
// Checks for updates against the URL declared in
// electron-builder.config.cjs's `publish` block (currently
// https://downloads.xchain.io/wallet/desktop/).
//
// electron-updater fetches the update-info file for its CHANNEL, not a
// file called "latest". Our channel is `stable`, so the shipped §2
// matrix is four pointers ( §7.1, names confirmed against a real
// build 2026-07-31):
//
//     stable.yml              Windows, x64 + arm64 in one file
//     stable-mac.yml          macOS, x64 + arm64 in one file
//     stable-linux.yml        Linux x64
//     stable-linux-arm64.yml  Linux arm64 (non-x64 Linux is arch-suffixed)
//
// It compares against the running version and, if newer, downloads the
// artifact into the userData dir, checks the SHA512 from the yml, and
// swaps it in on next launch. That SHA512 is a checksum from the same
// host as the binary, which is why `updateVerify.js` exists.
//
// Do not reintroduce the name `latest*.yml` here or in the release
// tooling: at channel `stable` it matches nothing, and everything that
// went looking for it failed silently rather than loudly.
//
// Signing check: electron-updater on Windows + macOS validates that
// the downloaded artifact is signed with the same publisher as the
// currently-installed app before letting the user install. Linux
// (.AppImage / .deb) had no equivalent: the SHA512 in the YML manifest
// is served by the same host as the binary, so it is a checksum, not a
// signature.  S5 (decision D5) closes that with a signed release
// manifest checked against a key pinned in the app; see
// `updateVerify.js` for the full argument, and REPRODUCIBLE_BUILDS.md
// "Update trust chain" for the surrounding model.
//
// `downloadAndInstall()` is the ONLY path to an install, and it runs
// that verification between the download and the install. This is
// deliberate: there is no unverified install path to accidentally wire
// up later, because there is no second path at all. The UI can only ask
// for the checked one.
//
// Dev mode: if running from `electron .` against source (not a packaged
// app), electron-updater's `isUpdaterActive()` returns false and we
// no-op. That's the correct posture; we don't want dev builds
// accidentally trying to self-update against the prod URL.

import { rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    fetchReleaseManifest,
    sha256File,
    verifyDownloadedUpdate,
} from './updateVerify.js';

/** Where the signed release manifests live. Matches the publish block. */
export const UPDATE_FEED_BASE_URL = 'https://downloads.xchain.io/wallet/';

/**
 * Turn an electron-updater feed URL into the base the signed manifests
 * live under.
 *
 * The feed is `<base>desktop/` (per-OS installers plus channel pointers);
 * the manifests are `<base>RELEASE_HASHES/<tag>.txt`. One trailing path
 * segment apart, by the §3 layout.
 *
 * @param {string} feedUrl
 * @returns {string} base URL, trailing slash included
 */
export function manifestBaseFromFeedUrl(feedUrl) {
    const normalised = String(feedUrl ?? '').replace(/\/*$/, '/');
    return normalised.replace(/desktop\/$/, '');
}

/**
 * The manifest base this BUILD should use, read from the `app-update.yml`
 * electron-builder baked into the bundle.
 *
 * WHY NOT THE CONSTANT. §7.5 rehearsal variants are ordinary builds with a
 * staging feed baked in. electron-updater already follows that baked URL,
 * but `fetchReleaseManifest` used a hardcoded production constant, so a
 * staging build would have downloaded its update from staging and then
 * demanded the signed manifest from PRODUCTION. Staging artifacts are
 * deliberately excluded from the production manifest (§7.5), so the hash
 * lookup could never match: every rehearsal would fail verification, and it
 * would look like a broken updater rather than a misrouted lookup. Reading
 * the baked file keeps the update and its proof on the same feed, whichever
 * feed that is.
 *
 * This is NOT a feed-override affordance in the §7.5 sense. It reads a file
 * inside the application bundle, written at build time, not an env var or an
 * external config; on macOS editing it breaks the bundle signature, and on
 * every OS an attacker who can rewrite files inside the installed app has
 * already won.
 *
 * Falls back to the production constant when there is no packaged
 * `app-update.yml`, which in practice means running from source in dev,
 * where the updater no-ops anyway.
 *
 * @param {Object} [opts]
 * @param {string} [opts.resourcesPath]
 * @param {(p: string, enc: string) => string} [opts.readFile]
 * @returns {string}
 */
export function resolveFeedBaseUrl({
    resourcesPath = process.resourcesPath,
    readFile = readFileSync,
} = {}) {
    if (!resourcesPath) return UPDATE_FEED_BASE_URL;
    try {
        const text = readFile(join(resourcesPath, 'app-update.yml'), 'utf8');
        // Horizontal whitespace only. `\s*` also matches the newline, so
        // `url:` with an empty value would capture the FOLLOWING line and
        // resolve the feed base from, say, `channel: stable`. That is a
        // wrong URL, not a fallback.
        const match = /^url:[ \t]*([^\n]*)$/m.exec(text);
        if (!match) return UPDATE_FEED_BASE_URL;
        const url = match[1].trim().replace(/^['"]|['"]$/g, '');
        return url ? manifestBaseFromFeedUrl(url) : UPDATE_FEED_BASE_URL;
    } catch {
        return UPDATE_FEED_BASE_URL;
    }
}

/**
 * @typedef {Object} UpdaterEvent
 * @property {'checking' | 'available' | 'not-available' | 'error' | 'downloaded' | 'progress' | 'verifying' | 'rejected'} type
 * @property {any} [info]
 */

/**
 * Wire electron-updater against the app's configured publish URL.
 * `loader` is injected for tests; production passes a loader that
 * dynamic-imports `electron-updater`.
 *
 * @param {Object} opts
 * @param {() => Promise<any>} [opts.loader]  dynamic-import `electron-updater`; injectable for tests
 * @param {(event: UpdaterEvent) => void} opts.onEvent   forwards updater events (the caller typically relays to the renderer)
 * @returns {Promise<{ checkForUpdates: () => Promise<void>, isActive: boolean }>}
 */
export async function attachUpdater({
    loader = defaultLoader,
    onEvent,
    feedBaseUrl = resolveFeedBaseUrl(),
    fetchImpl,
    pinned,
}) {
    if (typeof onEvent !== 'function') {
        throw new Error('attachUpdater: onEvent must be a function');
    }
    const mod = await loader();
    const autoUpdater = mod?.autoUpdater ?? mod?.default?.autoUpdater ?? mod?.default;
    if (!autoUpdater || typeof autoUpdater.checkForUpdates !== 'function') {
        throw new Error('attachUpdater: loaded module does not expose autoUpdater.checkForUpdates');
    }

    // Runtime dev-mode guard. electron-updater itself no-ops in dev;
    // we short-circuit to avoid registering listeners that'll never
    // fire.
    const isActive = typeof autoUpdater.isUpdaterActive === 'function'
        ? autoUpdater.isUpdaterActive()
        : true;
    if (!isActive) {
        return {
            isActive: false,
            async checkForUpdates() { /* no-op in dev */ },
            async downloadAndInstall() { /* no-op in dev */ },
        };
    }

    // We don't auto-download; the user clicks "install" from the
    // in-app notification, then autoUpdater.downloadUpdate() runs +
    // we relay progress events back.
    autoUpdater.autoDownload = false;

    // The most recent `update-downloaded` payload. electron-updater
    // reports the file it wrote here and nowhere else, and the install
    // gate needs that path to hash it.
    let downloaded = null;

    autoUpdater.on('checking-for-update', () => onEvent({ type: 'checking' }));
    autoUpdater.on('update-available', (info) => onEvent({ type: 'available', info }));
    autoUpdater.on('update-not-available', (info) => onEvent({ type: 'not-available', info }));
    autoUpdater.on('error', (err) => onEvent({ type: 'error', info: { message: String(err?.message || err) } }));
    autoUpdater.on('download-progress', (info) => onEvent({ type: 'progress', info }));
    autoUpdater.on('update-downloaded', (info) => {
        downloaded = info || null;
        onEvent({ type: 'downloaded', info });
    });

    /**
     * Wait for the download electron-updater is about to start.
     * `downloadUpdate()` resolves with the downloaded paths on current
     * versions, but the event carries the version too, so both are used
     * and neither is assumed.
     */
    async function runDownload() {
        downloaded = null;
        const paths = await autoUpdater.downloadUpdate();
        const fromEvent = downloaded;
        const path = fromEvent?.downloadedFile
            || (Array.isArray(paths) ? paths[0] : paths)
            || null;
        const version = fromEvent?.version || null;
        return { path: path ? String(path) : null, version };
    }

    return {
        isActive: true,

        async checkForUpdates() {
            try {
                await autoUpdater.checkForUpdates();
            } catch (err) {
                onEvent({ type: 'error', info: { message: String(err?.message || err) } });
            }
        },

        /**
         * Download the pending update, prove it is the artifact the
         * maintainer signed for that exact version, and only then
         * install. Any failure deletes the download and returns without
         * installing.
         *
         * @returns {Promise<{ ok: boolean, reason?: string }>}
         */
        async downloadAndInstall() {
            let artifactPath = null;
            try {
                const { path, version } = await runDownload();
                artifactPath = path;
                if (!artifactPath) {
                    return reject('update downloaded but its path was not reported');
                }
                if (!version) {
                    return reject('update downloaded but its version was not reported');
                }

                onEvent({ type: 'verifying', info: { version } });

                const tag = version.startsWith('v') ? version : `v${version}`;
                const fetched = await fetchReleaseManifest({
                    feedBaseUrl, tag, fetch: fetchImpl,
                });
                if (!fetched.ok) return reject(fetched.reason);

                const artifactSha256 = await sha256File(artifactPath);
                const verdict = await verifyDownloadedUpdate({
                    manifestBytes: fetched.manifestBytes,
                    armoredSignature: fetched.armoredSignature,
                    expectedTag: tag,
                    artifactPath,
                    artifactSha256,
                    ...(pinned === undefined ? {} : { pinned }),
                });
                if (!verdict.ok) return reject(verdict.reason);

                autoUpdater.quitAndInstall();
                return { ok: true };
            } catch (err) {
                return reject(String(err?.message || err));
            }

            // Refusing is not enough on its own: the rejected bytes are
            // sitting in the updater's cache, where a later run can find
            // them already downloaded. Delete them, then say why.
            async function reject(reason) {
                if (artifactPath) {
                    await rm(artifactPath, { force: true }).catch(() => { /* best effort */ });
                }
                onEvent({ type: 'rejected', info: { reason } });
                return { ok: false, reason };
            }
        },
    };
}

function defaultLoader() {
    return import('electron-updater');
}
