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
// "Swaps it in" means something different per Linux format, and the
// difference is a privilege boundary rather than a detail ( §5,
// measured 2026-08-02): the AppImage is replaced in place by the running
// process, while the `.deb` is installed by `dpkg -i` run through
// `pkexec`, so the user is asked for administrator rights. Both paths are
// live on both arches today. `downloadAndInstall()` below proves the
// bytes against K1 BEFORE either one runs, which is what makes the second
// acceptable: nothing reaches a root install without a maintainer
// signature over its hash.
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
 * Which Linux packaging a running build claims to be, read from the file
 * electron-updater reads: `resources/package-type`.
 *
 * @param {Object} [opts]
 * @param {string} [opts.resourcesPath]
 * @param {(p: string, enc: string) => string} [opts.readFile]
 * @returns {string|null} `deb` | `rpm` | `pacman` | null
 */
export function readPackageType({
    resourcesPath = process.resourcesPath,
    readFile = readFileSync,
} = {}) {
    if (!resourcesPath) return null;
    try {
        const raw = readFile(join(resourcesPath, 'package-type'), 'utf8');
        const value = String(raw).trim();
        return value || null;
    } catch {
        return null;
    }
}

/**
 * Choose the updater instance for this build.
 *
 * WHY WE CHOOSE AT ALL, INSTEAD OF TAKING `mod.autoUpdater`. On Linux
 * electron-updater picks the updater class by reading
 * `resources/package-type` out of the running bundle: `deb` gives
 * `DebUpdater`, whose install step is `dpkg -i` run through `pkexec`, i.e.
 * a root-privileged package install. That file is written by the deb
 * target into `dist/linux-unpacked/resources` - the SAME directory the
 * AppImage target packages from, while both targets are running
 * CONCURRENTLY over it (`AsyncTaskManager` has no concurrency control and
 * both Linux targets report `isAsyncSupported`).
 *
 * Measured 2026-08-02 on four packaged artifacts from two independent
 * container builds: the AppImage copy wins that race every time, so no
 * shipped AppImage carries `package-type` today, and the mksquashfs
 * wrapper now removes it from the stage tree so it cannot start. But
 * nothing in electron-builder ORDERS those two targets, so the property
 * was never guaranteed - it was observed.
 *
 * If it ever flipped, every check downstream would still pass: the
 * AppImage user's app would ask for the `.deb`, find it listed in the same
 * `stable-linux.yml`, match its sha512, match the K1-signed manifest that
 * legitimately covers it, and then ask for the admin password to install a
 * system package the user never chose - while the AppImage they are
 * running stays exactly as it was. Every layer of the update trust chain
 * would report success.
 *
 * So the running app decides for itself, from the one fact it cannot be
 * wrong about: `APPIMAGE` is set in the environment by the AppImage
 * runtime that started it. If the process is an AppImage, it gets the
 * AppImage updater whatever the bundle claims.
 *
 * @param {any} mod  the loaded electron-updater module
 * @param {Object} [opts]
 * @param {string} [opts.platform]
 * @param {Record<string, string|undefined>} [opts.env]
 * @param {string} [opts.resourcesPath]
 * @param {(p: string, enc: string) => string} [opts.readFile]
 * @returns {{ updater: any, mislabelledAs: string|null }}
 */
export function selectUpdater(mod, {
    platform = process.platform,
    env = process.env,
    resourcesPath = process.resourcesPath,
    readFile = readFileSync,
} = {}) {
    const takeDefault = () => ({
        updater: mod?.autoUpdater ?? mod?.default?.autoUpdater ?? mod?.default,
        mislabelledAs: null,
    });

    if (platform !== 'linux') return takeDefault();

    // Not an AppImage: electron-updater's own reading of `package-type` is
    // the right answer (deb -> DebUpdater, absent -> AppImageUpdater, which
    // then reports itself inactive because APPIMAGE is unset).
    if (!env.APPIMAGE) return takeDefault();

    const packageType = readPackageType({ resourcesPath, readFile });
    if (!packageType) return takeDefault();

    const AppImageUpdater = mod?.AppImageUpdater ?? mod?.default?.AppImageUpdater;
    if (typeof AppImageUpdater !== 'function') {
        // Cannot correct it, so do not proceed with the wrong one. An
        // updater that no-ops is a missed update; a DebUpdater on an
        // AppImage is a root install of the wrong artifact.
        return { updater: null, mislabelledAs: packageType };
    }
    return { updater: new AppImageUpdater(), mislabelledAs: packageType };
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
 * @param {Object} [opts.select]  overrides for `selectUpdater` (platform/env/resourcesPath/readFile); tests only
 * @returns {Promise<{ checkForUpdates: () => Promise<void>, isActive: boolean }>}
 */
export async function attachUpdater({
    loader = defaultLoader,
    onEvent,
    feedBaseUrl = resolveFeedBaseUrl(),
    fetchImpl,
    pinned,
    select,
}) {
    if (typeof onEvent !== 'function') {
        throw new Error('attachUpdater: onEvent must be a function');
    }

    // STORE BUILDS MUST NOT SELF-UPDATE ( §13 macOS, §15 Windows).
    // Both platforms hand updates to the store, and both tell the app so:
    // Electron sets `process.mas` on a Mac App Store build and
    // `process.windowsStore` on an MSIX/AppX one. In either channel there
    // is no feed of ours to check, an app that ships its own updater is a
    // certification failure, and the package could not replace itself
    // anyway - macOS because of the sandbox, Windows because an MSIX
    // install is immutable and updated only through the Store pipeline.
    //
    // The two flags differ in one way worth knowing: `process.mas` is a
    // build-time property of the packaging, while `process.windowsStore`
    // is set when the app is RUNNING from an MSIX package, so the same
    // bytes report differently depending on how they were installed. That
    // is the behaviour we want either way - what matters is whether the
    // running app is store-managed, not what it was compiled for.
    //
    // Short-circuit BEFORE loading electron-updater, so a store build
    // never registers the listeners or reaches the network.
    if (process.mas || process.windowsStore) {
        return {
            isActive: false,
            async checkForUpdates() { /* the store owns updates */ },
            async downloadAndInstall() { /* the store owns updates */ },
        };
    }

    const mod = await loader();
    const { updater: autoUpdater, mislabelledAs } = selectUpdater(mod, select);
    if (mislabelledAs) {
        // Loud, and not a user-facing toast: this is a build defect, not
        // something the user can act on. It means an AppImage shipped
        // carrying `package-type: <mislabelledAs>`, which would have routed
        // this install down that package manager's updater.
        console.error(
            `[xchain] this AppImage carries package-type "${mislabelledAs}"; `
            + 'forcing the AppImage updater ( §5)',
        );
    }
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

    // AND NOTHING INSTALLS ON QUIT (added 2026-08-02; this file claimed
    // "there is no second path at all" while there was one).
    //
    // `autoInstallOnAppQuit` defaults to TRUE, and `BaseUpdater` registers
    // the quit handler the moment a DOWNLOAD completes - inside
    // `runDownload()` below, before `verifyDownloadedUpdate` has fetched
    // the signed manifest, let alone checked it. So an ordinary quit
    // during that window installs an artifact nothing has proved: the
    // window is however long the manifest fetch takes, over whatever
    // network the user is on, and on the deb lane the install it performs
    // is a root-privileged `dpkg -i` (§5).
    //
    // The rejection path deletes the download, which narrowed the hole but
    // did not close it: deletion is best-effort, it only runs after a
    // verdict exists, and the dangerous case is the one with no verdict
    // yet. Turning the handler off makes the claim above true - the
    // verified `quitAndInstall()` in `downloadAndInstall()` is the only
    // way an update is ever installed. `quitAndInstall()` is unaffected:
    // it calls `install()` itself and does not go through the quit hook.
    autoUpdater.autoInstallOnAppQuit = false;

    // AND NO DOWNGRADES, EXPLICITLY, BECAUSE THE DEFAULT IS ONE ASSIGNMENT
    // AWAY FROM FLIPPING ( §7.4).
    //
    // The rollback doctrine rests on one property of electron-updater:
    // it never installs a version at or below the running one, so restoring
    // a previous release's yml is a safe first move during an incident -
    // clients on either version simply see "no update". Verified at 6.8.3:
    // `isUpdateAvailable` returns `allowDowngrade && isLatestVersionOlder`,
    // and `allowDowngrade` defaults to false.
    //
    // The trap is the `channel` SETTER. Assigning `autoUpdater.channel`
    // sets `allowDowngrade = true` as a side effect, documented only in a
    // comment on the setter. Our channel arrives inside `app-update.yml`
    // and never goes through it, so the default holds today - but §7.6
    // plans a `beta` channel, and the obvious way to implement a beta
    // opt-in is exactly `autoUpdater.channel = 'beta'`. That one line would
    // silently make every rollback yml installable as a downgrade, on a
    // fleet whose incident procedure assumes it cannot happen.
    //
    // Pinned here so the property is a decision rather than a default, and
    // so re-enabling it has to be written down.
    autoUpdater.allowDowngrade = false;

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
