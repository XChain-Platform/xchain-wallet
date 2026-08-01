// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// electron-builder configuration: Phase 2 Step 19 (§40.12, §51).
//
// Goals:
//   - Produce an installable artifact on all three target OSes (macOS,
//     Windows, Linux) from a single config.
//   - Level-2 reproducibility for the pre-signing artifact: a Docker
//     image + build script can produce a byte-identical zip/tar of the
//     app contents across independent builders. See REPRODUCIBLE_BUILDS.md.
//   - Code-signing structured but env-var-driven; no certs in repo.
//     `pnpm run dist` works without any cert config (produces unsigned
//     dev artifacts). Signed releases happen when CSC_LINK +
//     CSC_KEY_PASSWORD (or equivalents) are set in the environment.
//   - URI schemes registered at install time for later runtime opt-in:
//     xchain: claimed unconditionally; bitcoin/litecoin/dogecoin
//     registered so the OS knows we CAN handle them, but
//     `setAsDefaultProtocolClient` is runtime-gated in main/protocol.js.
//   - Hardened runtime + notarization entitlements (macOS) + publisher
//     metadata (Windows) wired via env vars, skipped cleanly when the
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

// Deterministic clock source: electron-builder injects a build
// timestamp into several places (zip entries, PE headers). Pinning
// SOURCE_DATE_EPOCH (Reproducible Builds spec, https://reproducible-builds.org/docs/source-date-epoch/)
// makes the output stable across independent builders. reproduce.sh
// sets this to the HEAD commit's author date; leaving it unset means
// `new Date()` at build time, so CI dev builds differ between runs.
const epoch = process.env.SOURCE_DATE_EPOCH
    ? Number(process.env.SOURCE_DATE_EPOCH)
    : undefined;

// --- Update feed ( §7.1, §7.5) -------------------------------------
//
// The production feed and channel. `channel` IS the update-info filename
// stem, so these two lines name the four files the feed must serve
// (stable.yml / stable-mac.yml / stable-linux.yml / stable-linux-arm64.yml).
// Any installed build keeps asking for the name it was built with, forever.
// Treat both as a wire format.
const PROD_FEED_URL = 'https://downloads.xchain.io/wallet/desktop/';
const PROD_CHANNEL = 'stable';

// §7.5 rehearsal variants. `XCHAIN_STAGING_FEED_URL` is a BUILD-TIME input
// only: it selects what gets baked into the artifact, and the shipped app
// has no way to read it or to change its feed afterwards. That distinction
// is the whole point of the rule. A production build sets nothing here and
// is byte-identical in configuration to one built before staging existed.
//
// Staging variants also build to their OWN output directory. electron-builder
// names artifacts by version, not by channel, so a staging dmg and a prod dmg
// are byte-different twins under the SAME filename; sharing a directory would
// mean the last build silently wins and a staging binary could be signed and
// published as the real one.
const STAGING_FEED_URL = process.env.XCHAIN_STAGING_FEED_URL || null;
const isStaging = Boolean(STAGING_FEED_URL);

// Every architecture we ship (§2 matrix). No 32-bit anywhere: win-ia32 is
// declined by policy (its only audience is 32-bit Windows 10, out of
// support since 2025-10), and mac/linux ia32 are impossible in a modern
// Electron. linux-armv7l is post-launch on demand (DD1).
const ARCHES = ['x64', 'arm64'];

// §7.5: a rehearsal variant is built ONLY for the format electron-updater
// can actually swap in place on that OS. A staging dmg, deb or win-zip
// exercises nothing, because none of them has an auto-update path.
//
// This restriction lives in the CONFIG, not in a CLI argument, because the
// CLI form does not do it: a `--mac zip` run was observed building the dmg
// as well (2026-07-31), so the rehearsal set would have quietly included
// formats it is not supposed to contain, and the staging pointer would
// have listed them. Declared here it is one value, testable without a
// build.
const UPDATE_CAPABLE_TARGET = {
    mac: [{ target: 'zip', arch: ARCHES }],
    win: [{ target: 'nsis', arch: ARCHES }],
    linux: [{ target: 'AppImage', arch: ARCHES }],
};

// --- Artifact names carry their architecture ( DD4) ----------------
//
// THIS IS AN UPDATE-CORRECTNESS SETTING, NOT COSMETICS.
//
// electron-updater picks which artifact to download with, in effect:
//
//     files.find(f => f.url.includes(process.arch)) ?? files.shift()
//
// (`findFile` in electron-updater 6.8.3 `out/providers/Provider.js`; the
// Windows, macOS and AppImage updaters all route through it.) So selection
// is a SUBSTRING MATCH of "x64" or "arm64" against the filename, with a
// fall back to whichever file happens to be listed FIRST.
//
// electron-builder omits the arch from x64 filenames by default. That means
// an x64 machine matches nothing, falls through to `.shift()`, and gets the
// first entry in the yml. It works today only because x64 happens to be
// built, and therefore listed, before arm64. Reverse the build order, or
// re-run a single arch lane, and every x64 user is silently offered the
// arm64 installer. Nothing in the build or the feed would look wrong.
//
// Naming every artifact with its arch makes the match succeed by NAME for
// both arches, so ordering stops being load-bearing. Supplying any
// artifactName sets electron-builder's `isUserForced`, which is what stops
// it stripping `${arch}` from the x64 name (`expandArtifactNamePattern` in
// app-builder-lib).
//
// Linux is deliberately left at its defaults: it gets one update-info file
// PER ARCH (`stable-linux.yml` vs `stable-linux-arm64.yml`), so each yml
// only ever lists its own arch and there is no selection to get wrong. The
// deb target also has its own Debian arch naming (amd64), which this
// pattern would fight.
const MAC_ARTIFACT = '${productName}-${version}-${arch}-mac.${ext}';
const DMG_ARTIFACT = '${productName}-${version}-${arch}.${ext}';
const WIN_ARTIFACT = '${productName}-${version}-${arch}-win.${ext}';
const NSIS_ARTIFACT = '${productName} Setup ${version}-${arch}.${ext}';

// --- Windows signing identity ( §4, DD2) ---------------------------
//
// The certificate subject CN, pinned. electron-updater refuses an update
// whose publisher does not match the installed app's, so this string is
// effectively a wire format: changing it makes every existing install stop
// accepting updates, and the migration is a dual-signed bridge release.
// It is NOT a display name to tidy up.
const WIN_PUBLISHER = 'Dankest, LLC';

// electron-builder v26 takes Windows signing through EITHER
// `win.signtoolOptions` (classic cert) OR `win.azureSignOptions` (Azure
// Trusted Signing), never both - upstream's own doc comment says setting
// both silently defaults to Azure. So the choice is made once, here, off
// the environment, and only one key is ever emitted.
//
// Azure needs four config values; the three Entra ID credentials
// (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET) are read from
// the environment by the Azure SDK itself and deliberately never appear in
// this file. `endpoint` is REQUIRED by the v26 type and is region-specific,
// which is why it is its own variable rather than a default.
//
// DD2 is still open, so this is a skeleton: with no Azure vars set it is
// entirely inert and the classic-cert path is used exactly as before. A
// dev build with no cert config at all still produces unsigned artifacts.
const azureSigning
    = process.env.AZURE_CODE_SIGNING_ENDPOINT
        && process.env.AZURE_CODE_SIGNING_NAME
        && process.env.AZURE_CERT_PROFILE_NAME
        ? {
            publisherName: WIN_PUBLISHER,
            endpoint: process.env.AZURE_CODE_SIGNING_ENDPOINT,
            codeSigningAccountName: process.env.AZURE_CODE_SIGNING_NAME,
            certificateProfileName: process.env.AZURE_CERT_PROFILE_NAME,
        }
        : null;

/** @type {import('electron-builder').Configuration} */
const config = {
    appId: 'io.xchain.wallet.desktop',
    productName: 'XChain Wallet',
    copyright: 'Copyright © Dankest, LLC',

    // NOTE: the `homepage` the .deb lane requires is NOT settable here.
    // v26's schema sets additionalProperties:false at the root and
    // rejects it outright ("configuration has an unknown property
    // 'homepage'"), which is the good failure mode. It is app METADATA,
    // so it lives in packages/desktop/package.json; see the comment there.

    // Explicit asar: reduces startup I/O + lets electron-builder
    // write deterministic archive entries. Native modules (none right
    // now: WebHID + Trezor Connect are pure JS) would need
    // asarUnpack; revisit if node-HID is ever added.
    asar: true,

    // Resources we ship alongside the app bundle. The renderer build
    // output lives at renderer/dist/; main/ + preload.cjs are copied as
    // source (Electron loads main's ESM directly from asar; the preload
    // is CJS because sandboxed preloads cannot be ESM).
    files: [
        'main/**/*',
        'preload.cjs',
        'renderer/dist/**/*',
        'package.json',
        '!**/node_modules/*/{test,__tests__,tests,example,examples}',
        '!**/*.map',
        '!**/.DS_Store',
    ],

    // `npmRebuild: false` skips electron-builder's post-install
    // rebuild step; we have no native deps, so the step is
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
        output: isStaging ? 'dist-staging' : 'dist',
        buildResources: 'build',
    },

    // URI schemes: §40.12 Tier 1 + Tier 2 as documented in main/protocol.js.
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
        artifactName: MAC_ARTIFACT,
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
        target: isStaging ? UPDATE_CAPABLE_TARGET.mac : [
            { target: 'dmg', arch: ARCHES },
            { target: 'zip', arch: ARCHES },
        ],
        // Signing identity comes from CSC_LINK / CSC_KEY_PASSWORD
        // (electron-builder picks these up automatically). If unset,
        // build produces an unsigned .app: fine for dev, rejected on
        // Gatekeeper-strict configs on user machines.
        identity: process.env.CSC_IDENTITY_NAME || null,
        // Notarization only runs when the Apple credentials are present.
        //
        // v26 changed this from an object to a BOOLEAN: the team id and
        // everything else now come from env vars
        // (APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER, plus
        // APPLE_TEAM_ID). The old `{ teamId }` object is no longer a valid
        // value. Left as an object it fails config validation outright,
        // which is the good case; the bad case would have been silent
        // acceptance and an un-notarized build that Gatekeeper blocks on
        // every user's machine.
        notarize: Boolean(process.env.APPLE_API_KEY_ID),
    },
    dmg: {
        artifactName: DMG_ARTIFACT,
        writeUpdateInfo: true,
    },

    // --- Windows -------------------------------------------------------
    win: {
        artifactName: WIN_ARTIFACT,
        target: isStaging ? UPDATE_CAPABLE_TARGET.win : [
            { target: 'nsis', arch: ARCHES },
            { target: 'zip', arch: ARCHES },
        ],

        // electron-builder v26 moved every signtool setting off `win` and
        // into `win.signtoolOptions`. Verified against 26.15.7: the v26
        // schema sets `additionalProperties: false` on `win`, so the old
        // layout is REJECTED outright ("configuration.win should be one of
        // these: null") before any build work happens. That is the good
        // failure mode, and it is why this migration is safe to make.
        //
        // The mutual exclusion below is the part that is NOT loud: per
        // upstream's own doc comment, setting both `signtoolOptions` and
        // `azureSignOptions` does not error, it silently defaults to
        // Azure. So exactly one key is ever emitted (see azureSigning).
        ...(azureSigning
            ? { azureSignOptions: azureSigning }
            : {
                signtoolOptions: {
                    publisherName: WIN_PUBLISHER,
                    // Authenticode: CSC_LINK + CSC_KEY_PASSWORD drive
                    // signing. Timestamp server pinned so signatures stay
                    // verifiable after cert expiry (RFC 3161 SHA256).
                    signingHashAlgorithms: ['sha256'],
                    rfc3161TimeStampServer: 'http://timestamp.digicert.com',
                },
            }),
    },
    nsis: {
        artifactName: NSIS_ARTIFACT,
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        perMachine: false,
        deleteAppDataOnUninstall: false,
        // Deterministic uninstaller name; the default injects a timestamp.
        uninstallDisplayName: '${productName}',
        // Differential updates are a non-goal ( §7), so do not emit
        // the delta metadata for them. This also stops the channel pointer
        // (`stable.yml` on Windows - never `latest.yml`, which is the
        // default channel's name and not ours) from advertising a
        // blockMapSize for a file we deliberately do not publish.
        // NOTE: this only covers nsis. The macOS zip blockmap is
        // produced unconditionally whenever update info is written (there
        // is no opt-out in app-builder-lib), so the `rm -f *.blockmap`
        // step in release.yml is load-bearing, not belt-and-braces.
        differentialPackage: false,
    },

    // --- Linux ---------------------------------------------------------
    linux: {
        // WITHOUT THIS THE ENTIRE LINUX LANE FAILS TO BUILD, and it had
        // never been noticed because the lane had never been run: CI is
        // not configured yet, and the reproduce container uses `--dir`,
        // which packages nothing and so never reaches this code path.
        //
        // electron-builder derives the Linux executable name from the
        // package.json `name` (appInfo.linuxPackageName), not from
        // productName. Ours is `@xchain-wallet/desktop`, which sanitizes
        // to `@xchain-walletdesktop`, and the AppImage builder rejects it:
        //
        //   ⨯ failed to build AppImage  error=executableName contains
        //     characters that cannot be safely used in file paths:
        //     @xchain-walletdesktop
        //
        // Both arches, hard failure, so no .AppImage is produced at all -
        // and `*.AppImage` is a REQUIRED row in expected-artifacts.txt.
        // `@` is equally illegal in a Debian package name, so the .deb was
        // on the same path. Pinned explicitly here rather than left to a
        // default that reads the npm scope of a private workspace package.
        executableName: 'xchain-wallet',
        target: isStaging ? UPDATE_CAPABLE_TARGET.linux : [
            { target: 'AppImage', arch: ARCHES },
            { target: 'deb', arch: ARCHES },
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
        // THIS COMMENT USED TO SAY setting SOURCE_DATE_EPOCH was enough to
        // make the AppImage reproducible. MEASURED 2026-08-01, it is not.
        //
        // Two packaged builds of the same commit, same epoch, same
        // container produce byte-DIFFERENT AppImages on both arches, while
        // the .deb files from those same runs are byte-identical. Reading
        // the AppImage's squashfs superblock (validated: v4.0, offset
        // 188392, block_size 131072) shows why:
        //
        //   mkfs_time         = 1785618191  (build wall clock)
        //   SOURCE_DATE_EPOCH = 1785601315  (the commit's author date)
        //
        // So the superblock timestamp is written from the clock regardless
        // of the env var. That is at least one cause; whether it is the
        // only one is not established, because patching 4 bytes after the
        // fact would desync the embedded block map electron-builder writes
        // over the finished image.
        //
        // Consequence, and it is the whole of  DD7: the .deb can be
        // verified byte-for-byte against what we publish, and the AppImage
        // cannot. Do not restore the old claim without a measurement.
    },
    deb: {
        // The default artifact name is `${name}_${version}_${arch}.${ext}`
        // and `${name}` is the package.json name, `@xchain-wallet/desktop`.
        // That is not a cosmetic problem: it contains a SLASH, so
        // electron-builder was writing to
        // `dist/@xchain-wallet/desktop_0.333.1_amd64.deb` - a file in a
        // subdirectory nothing looks in. `publish.sh` enumerates the
        // staging directory and `expected-artifacts.txt` matches basenames,
        // so the .deb would have gone missing from the release rather than
        // failed it. Debian's own rules also forbid `@` and uppercase in a
        // package name, so the default was invalid twice over.
        //
        // Pinned to the Debian convention: <name>_<version>_<arch>.deb.
        // NOTE this does NOT settle §7.1's open artifactName question for
        // the other targets: the AppImage, dmg, exe and zips still carry
        // `${productName}` and therefore a SPACE, and that remains the
        // operator's call. This is only the target whose default name was
        // structurally broken.
        artifactName: 'xchain-wallet_${version}_${arch}.${ext}',
        // Pin compression + omit non-deterministic build fields.
        // fpm (which electron-builder invokes) respects SOURCE_DATE_EPOCH
        // for ar-archive mtimes.
        compression: 'xz',
    },

    // --- electron-updater --------------------------------------------
    // Update channel config (§40.12 Step 19 Q3: electron-updater over
    // generic https). `publish: null` means the build CLI doesn't
    // auto-upload; we control release cadence manually. The renderer
    // still gets update checks at runtime via `main/updater.js`, which
    // points at the URL below.
    //
    // `generic` provider reads an `app-update.yml` shipped in the
    // bundle + fetches the matching artifact + the update-info file from
    // the update URL. Self-hosting keeps us off GitHub releases (and
    // keeps telemetry inside xchain.io).
    //
    // `channel` IS the update-info filename stem, so this line names the
    // four files the feed has to serve: stable.yml (Windows),
    // stable-mac.yml, stable-linux.yml, stable-linux-arm64.yml. Changing
    // it renames all of them, and any installed build keeps asking for
    // the name it was built with, forever. Treat it as a wire format
    // ( §7.1).
    publish: [
        {
            provider: 'generic',
            url: isStaging ? STAGING_FEED_URL : PROD_FEED_URL,
            channel: isStaging ? 'staging' : PROD_CHANNEL,
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
