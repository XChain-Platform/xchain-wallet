// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// electron-updater wiring — §40.12 Step 19.
//
// Checks for updates against the URL declared in
// electron-builder.config.cjs's `publish` block (currently
// https://downloads.xchain.io/wallet/desktop/). electron-updater fetches
// `latest.yml` (Windows) / `latest-mac.yml` (macOS) / `latest-linux.yml`
// (Linux) from that URL, compares against the running version, and —
// if newer — downloads the artifact into the userData dir, verifies
// the SHA512 from the yml manifest, and swaps it in on next launch.
//
// Signing check: electron-updater on Windows + macOS validates that
// the downloaded artifact is signed with the same publisher as the
// currently-installed app before letting the user install. Linux
// (.AppImage / .deb) relies on us shipping the SHA512 in the YML
// manifest — that's the only integrity check the user gets. See
// REPRODUCIBLE_BUILDS.md "Update trust chain" for the full model.
//
// This module is deliberately thin — just bootstraps the updater,
// registers a small set of renderer-visible events, and exposes a
// `checkForUpdates()` helper. Richer UX (auto-download toggle,
// release-notes viewer, "remind me later") lands in a dedicated UI
// step; for Step 19 we verify the plumbing works and surface a
// generic toast to the renderer.
//
// Dev mode: if running from `electron .` against source (not a packaged
// app), electron-updater's `isUpdaterActive()` returns false and we
// no-op. That's the correct posture — we don't want dev builds
// accidentally trying to self-update against the prod URL.

/**
 * @typedef {Object} UpdaterEvent
 * @property {'checking' | 'available' | 'not-available' | 'error' | 'downloaded' | 'progress'} type
 * @property {any} [info]
 */

/**
 * Wire electron-updater against the app's configured publish URL.
 * `loader` is injected for tests — production passes a loader that
 * dynamic-imports `electron-updater`.
 *
 * @param {Object} opts
 * @param {() => Promise<any>} [opts.loader]  dynamic-import `electron-updater`; injectable for tests
 * @param {(event: UpdaterEvent) => void} opts.onEvent   forwards updater events (the caller typically relays to the renderer)
 * @returns {Promise<{ checkForUpdates: () => Promise<void>, isActive: boolean }>}
 */
export async function attachUpdater({ loader = defaultLoader, onEvent }) {
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
        };
    }

    // We don't auto-download — the user clicks "install" from the
    // in-app notification, then autoUpdater.downloadUpdate() runs +
    // we relay progress events back.
    autoUpdater.autoDownload = false;

    autoUpdater.on('checking-for-update', () => onEvent({ type: 'checking' }));
    autoUpdater.on('update-available', (info) => onEvent({ type: 'available', info }));
    autoUpdater.on('update-not-available', (info) => onEvent({ type: 'not-available', info }));
    autoUpdater.on('error', (err) => onEvent({ type: 'error', info: { message: String(err?.message || err) } }));
    autoUpdater.on('download-progress', (info) => onEvent({ type: 'progress', info }));
    autoUpdater.on('update-downloaded', (info) => onEvent({ type: 'downloaded', info }));

    return {
        isActive: true,
        async checkForUpdates() {
            try {
                await autoUpdater.checkForUpdates();
            } catch (err) {
                onEvent({ type: 'error', info: { message: String(err?.message || err) } });
            }
        },
    };
}

function defaultLoader() {
    return import('electron-updater');
}
