// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// electron-builder configuration — Phase 2 Step 19 (§40.12, §51).
//
// Goals:
//   - Produce an installable artifact on all three target OSes (macOS,
//     Windows, Linux) from a single config.
//   - Level-2 reproducibility for the pre-signing artifact: a Docker
//     image + build script can produce a byte-identical zip/tar of the
//     app contents across independent builders. See REPRODUCIBLE_BUILDS.md.
//   - Code-signing structured but env-var-driven — no certs in repo.
//     `pnpm run dist` works without any cert config (produces unsigned
//     dev artifacts). Signed releases happen when CSC_LINK +
//     CSC_KEY_PASSWORD (or equivalents) are set in the environment.
//   - URI schemes registered at install time for later runtime opt-in:
//     xchain: claimed unconditionally; bitcoin/litecoin/dogecoin
//     registered so the OS knows we CAN handle them, but
//     `setAsDefaultProtocolClient` is runtime-gated in main/protocol.js.
//   - Hardened runtime + notarization entitlements (macOS) + publisher
//     metadata (Windows) wired via env vars — skipped cleanly when the
//     env doesn't supply them.
//
// This file stays .cjs because electron-builder's config loader
// prefers CommonJS; exporting via `module.exports` keeps it
// round-trippable through both builder CLI and our smoke tests.

'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const here = __dirname;
const rootPkg = JSON.parse(
    readFileSync(join(here, '..', '..', 'package.json'), 'utf8'),
);

// Deterministic clock source — electron-builder injects a build
// timestamp into several places (zip entries, PE headers). Pinning
// SOURCE_DATE_EPOCH (Reproducible Builds spec — https://reproducible-builds.org/docs/source-date-epoch/)
// makes the output stable across independent builders. reproduce.sh
// sets this to the HEAD commit's author date; leaving it unset means
// `new Date()` at build time, so CI dev builds differ between runs.
const epoch = process.env.SOURCE_DATE_EPOCH
    ? Number(process.env.SOURCE_DATE_EPOCH)
    : undefined;

/** @type {import('electron-builder').Configuration} */
const config = {
    appId: 'io.xchain.wallet',
    productName: 'XChain Wallet',
    copyright: 'Copyright © Dankest, LLC',

    // Explicit asar — reduces startup I/O + lets electron-builder
    // write deterministic archive entries. Native modules (none right
    // now — WebHID + Trezor Connect are pure JS) would need
    // asarUnpack; revisit if node-HID is ever added.
    asar: true,

    // Resources we ship alongside the app bundle. The renderer build
    // output lives at renderer/dist/; main/ + preload.js are copied as
    // source (Electron can load ESM directly from asar).
    files: [
        'main/**/*',
        'preload.js',
        'renderer/dist/**/*',
        'package.json',
        '!**/node_modules/*/{test,__tests__,tests,example,examples}',
        '!**/*.map',
        '!**/.DS_Store',
    ],

    // `npmRebuild: false` skips electron-builder's post-install
    // rebuild step — we have no native deps, so the step is
    // unnecessary noise and a source of non-determinism (it invokes
    // node-gyp which touches timestamps).
    npmRebuild: false,

    // `buildDependenciesFromSource: false` opts out of building
    // Electron itself from source. We verify the prebuilt download's
    // SHA256 against electron-builder's baked-in list, which is good
    // enough for Level 2 (the Electron dist channel is a known trust
    // anchor we can't elide without shipping our own Chromium fork).
    buildDependenciesFromSource: false,

    directories: {
        output: 'dist',
        buildResources: 'build',
    },

    // URI schemes — §40.12 Tier 1 + Tier 2 as documented in main/protocol.js.
    // This declares the OS metadata; runtime claim (setAsDefaultProtocolClient)
    // is gated per-scheme in main/protocol.js so users who already have
    // a primary BTC/LTC/DOGE wallet don't get silently overridden.
    protocols: [
        {
            name: 'XChain Action',
            schemes: ['xchain'],
        },
        {
            name: 'Bitcoin Payment',
            schemes: ['bitcoin'],
        },
        {
            name: 'Litecoin Payment',
            schemes: ['litecoin'],
        },
        {
            name: 'Dogecoin Payment',
            schemes: ['dogecoin'],
        },
    ],

    // --- macOS ---------------------------------------------------------
    mac: {
        category: 'public.app-category.finance',
        // `darkModeSupport` uses the system theme; we do this already
        // via tokens.css so the native window chrome matches.
        darkModeSupport: true,
        // Hardened runtime is required for notarization. Entitlements
        // live alongside the config in build/entitlements.mac.plist.
        hardenedRuntime: true,
        gatekeeperAssess: false,
        entitlements: 'build/entitlements.mac.plist',
        entitlementsInherit: 'build/entitlements.mac.plist',
        target: [
            { target: 'dmg', arch: ['x64', 'arm64'] },
            { target: 'zip', arch: ['x64', 'arm64'] },
        ],
        // Signing identity comes from CSC_LINK / CSC_KEY_PASSWORD
        // (electron-builder picks these up automatically). If unset,
        // build produces an unsigned .app — fine for dev, rejected on
        // Gatekeeper-strict configs on user machines.
        identity: process.env.CSC_IDENTITY_NAME || null,
        // Notarization — only runs when APPLE_API_KEY_ID + APPLE_API_ISSUER
        // are present. Skipped cleanly otherwise.
        notarize: process.env.APPLE_API_KEY_ID
            ? {
                teamId: process.env.APPLE_TEAM_ID,
            }
            : false,
    },
    dmg: {
        writeUpdateInfo: true,
    },

    // --- Windows -------------------------------------------------------
    win: {
        target: [
            { target: 'nsis', arch: ['x64', 'arm64'] },
            { target: 'zip', arch: ['x64', 'arm64'] },
        ],
        publisherName: 'Dankest, LLC',
        // Authenticode — CSC_LINK + CSC_KEY_PASSWORD drive signing.
        // Timestamp server pinned so signatures remain verifiable after
        // cert expiry (RFC 3161 SHA256 timestamping).
        signingHashAlgorithms: ['sha256'],
        rfc3161TimeStampServer: 'http://timestamp.digicert.com',
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        perMachine: false,
        deleteAppDataOnUninstall: false,
        // Deterministic uninstaller name — default injects a timestamp.
        uninstallDisplayName: '${productName}',
    },

    // --- Linux ---------------------------------------------------------
    linux: {
        target: [
            { target: 'AppImage', arch: ['x64', 'arm64'] },
            { target: 'deb', arch: ['x64', 'arm64'] },
        ],
        category: 'Finance',
        maintainer: 'Dankest, LLC <support@xchain.io>',
        synopsis: 'Self-custodial multi-chain XChain Platform wallet',
        description:
            'Self-custodial wallet for the XChain Platform (Bitcoin, Dogecoin, '
                + 'Litecoin). Supports token issuance, hardware signers (Ledger + '
                + 'Trezor via WebHID), and the full XChain action surface.',
    },
    appImage: {
        // Make the AppImage's squashfs entries reproducible. mksquashfs
        // honours SOURCE_DATE_EPOCH when invoked by electron-builder,
        // so setting the env var is enough.
    },
    deb: {
        // Pin compression + omit non-deterministic build fields.
        // fpm (which electron-builder invokes) respects SOURCE_DATE_EPOCH
        // for ar-archive mtimes.
        compression: 'xz',
    },

    // --- electron-updater --------------------------------------------
    // Update channel config (§40.12 Step 19 Q3 — electron-updater over
    // generic https). `publish: null` means the build CLI doesn't
    // auto-upload; we control release cadence manually. The renderer
    // still gets update checks at runtime via `main/updater.js`, which
    // points at the URL below.
    //
    // `generic` provider reads an `app-update.yml` shipped in the
    // bundle + fetches the matching artifact + `latest*.yml` from the
    // update URL. Self-hosting keeps us off GitHub releases (and keeps
    // telemetry inside xchain.io).
    publish: [
        {
            provider: 'generic',
            url: 'https://downloads.xchain.io/wallet/desktop/',
            channel: 'stable',
        },
    ],

    // --- Extra metadata -----------------------------------------------
    extraMetadata: {
        version: rootPkg.version,
        // SOURCE_DATE_EPOCH → build.buildDate (fallback to now for dev).
        // Writes a single `buildDate` into the app's package.json so
        // `about` dialogs can show it without every component needing
        // to read env-vars.
        buildDate: epoch
            ? new Date(epoch * 1000).toISOString()
            : new Date().toISOString(),
    },
};

module.exports = config;
