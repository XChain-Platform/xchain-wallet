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
//     app contents across independent builders. See the desktop section
//     of https://docs.xchain.io/components/wallet/reproducible-builds.
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

const { assertWindowsSigningMaterial } = require('./scripts/windows-signing.cjs');

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

// --- Update feed (§7.1, §7.5) -------------------------------------
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

// Mac App Store channel (§13). Opt-in, because the target cannot
// build without an Apple Distribution certificate and a provisioning
// profile: leaving it on would break every dev and CI mac build that has
// neither. A staging/rehearsal build never gets it either - the App Store
// owns updates for that channel, so there is no feed to rehearse against.
const buildMas = process.env.XCHAIN_BUILD_MAS === '1' && !isStaging;

// The qualifier the store build looks its TWO certificates up by, and it
// has to be a qualifier rather than a certificate name.
//
// `mas.identity` is not only the app-signing identity: app-builder-lib
// passes the same string to the installer lookup,
// `findIdentity('3rd Party Mac Developer Installer', mas.identity)`, and
// `_findIdentity` matches with `line.includes(qualifier)`. So the full name
// of the Apple Distribution certificate finds the app certificate and then
// cannot find the installer one, and the build dies at the pkg step. The
// value that matches both is the part they share, which is the team.
//
// It must also never be `null` or absent. `mas` config is
// `deepAssign(mac, mas)`, `mac.identity` is null on any machine that was
// handed no signing certificate, and `macPackager.sign` returns on a null
// identity BEFORE the step that builds the .pkg - silently, exit 0, no
// artifact. The store lane never inherits it, and defaults non-null even
// with no signing environment at all, because a store build is never a
// legitimately unsigned one.
//
// The team is one constant for both macOS channels: `Developer ID
// Application: Dankest, LLC (829JG9YLH3)` and the two store certificates
// share exactly this substring, and that shared part is the only value
// `line.includes(qualifier)` matches across all of them.
const TEAM_QUALIFIER = 'Dankest, LLC';
const MAS_IDENTITY = process.env.MAS_IDENTITY_NAME || process.env.CSC_IDENTITY_NAME || TEAM_QUALIFIER;

// Whether this build was handed a Developer ID certificate to sign with.
// CSC_LINK is how release.yml supplies one; CSC_KEYCHAIN is how a local
// Developer-ID rehearsal supplies one already imported into a keychain.
const macSigningCertSupplied = Boolean(process.env.CSC_LINK || process.env.CSC_KEYCHAIN);

// The direct-download qualifier, defaulted HERE rather than in the
// workflow. This was `CSC_IDENTITY_NAME || null`, and the only
// non-null source of it anywhere was one env line in each of release.yml's
// two Developer-ID steps: `macPackager.sign` tests `qualifier === null`
// before it looks at CSC_LINK and before notarization, so deleting either
// line signed nothing, notarized nothing, exited 0, and shipped correctly
// named installers that Gatekeeper blocks on every user's machine.
//
// Null stays the answer when no certificate was supplied, because that is
// the dev-machine case and it must stay quiet: a non-null qualifier with no
// matching certificate makes app-builder-lib shell out to `security
// find-identity` and warn on every build. So the certificate itself is the
// trigger, which is a thing the lane cannot lose without failing loudly.
const MAC_IDENTITY = process.env.CSC_IDENTITY_NAME || (macSigningCertSupplied ? TEAM_QUALIFIER : null);

// The Microsoft Store lane (§15), opt-in for the same three
// reasons as MAS. It needs a Partner-Center-assigned publisher identity
// nobody has yet; it can only be produced on a Windows 10+ host (or a
// macOS host driving a Parallels VM, which no CI runner is), so an
// unconditional target would break every mac and linux build; and a
// rehearsal build must never carry it, because the Store owns updates for
// that channel and there is nothing to rehearse.
const buildAppx = process.env.XCHAIN_BUILD_APPX === '1' && !isStaging;

// The Snap Store lane (§16), opt-in for the same reasons
// as MAS and AppX. Building a snap runs the real snapcraft CLI (this
// app-builder-lib's core24 strategy shells out to it), which no dev box
// or default runner is guaranteed to have; and a rehearsal build must
// never carry it, because snapd owns updates for that channel and there
// is nothing to rehearse against our staging feed.
const buildSnap = process.env.XCHAIN_BUILD_SNAP === '1' && !isStaging;

// §7.5: a rehearsal variant is built ONLY for the formats electron-updater
// can actually swap in place on that OS. A staging dmg or win-zip
// exercises nothing, because neither has an auto-update path.
//
// THE.deb BELONGS HERE AND WAS MISSING (added 2026-08-02, §5). It
// sat in the same sentence as the dmg on the strength of one belief: that
// electron-updater's deb path "needs privilege escalation" and therefore
// does not exist. It exists. `DebUpdater` in the pinned electron-updater
// 6.8.9 selects the `.deb` from the pointer, downloads it and installs it
// with `dpkg -i` under `pkexec`; the escalation IS the install step, and it
// prompts. Our packaged `.deb` ships `resources/package-type` containing
// `deb` (verified with `dpkg-deb -c` on a real build), which is exactly
// what makes electron-updater pick that class, and both Linux pointers have
// been listing the `.deb` next to the AppImage all along.
//
// So the update path that ends in a ROOT-privileged package install was the
// one path a rehearsal could never cover, because the staging build emitted
// no `.deb` for a staging feed to serve. See tools/release/rehearsal-matrix.mjs.
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
    linux: [
        { target: 'AppImage', arch: ARCHES },
        { target: 'deb', arch: ARCHES },
    ],
};

// --- Artifact names carry their architecture (DD4) ----------------
//
// THIS IS AN UPDATE-CORRECTNESS SETTING, NOT COSMETICS.
//
// electron-updater picks which artifact to download with, in effect:
//
//     files.find(f => f.url.includes(process.arch)) ?? files.shift()
//
// (`findFile` in electron-updater 6.8.9 `out/providers/Provider.js`; the
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
// EVERY ARTIFACT IS NAMED `xchain-wallet-...`, NOT `${productName}-...`
// (operator decision 2026-08-02, §7.1: lowercase-with-dashes).
//
// `productName` is "XChain Wallet", with a SPACE, and app-builder-lib's
// space-to-dash `safeArtifactName` substitution is gated on
// `provider === "github"`, which the generic provider is not. So the space
// reached the published filename, the channel pointer carried it raw, and
// every client requested `%20`. Any tooling that pasted an artifact name
// into a URL without encoding it - the edge check, a monitoring probe, a
// cache-purge call - then asked for a malformed URL and failed a release
// that was fine. Encoding it correctly everywhere is a rule someone has to
// keep remembering; not having a space in the name is a property.
//
// The literal is spelled out rather than derived from `name`, because
// package.json's is the scoped `@xchain-wallet/desktop`: the same value
// that broke `executableName` and the AppImage build outright (§5) and
// that AppX rejects as an identity (§15). It matches `executableName` and
// the deb's `xchain-wallet_<version>_<arch>.deb`, both of which already
// followed this convention.
//
// Linux gets a forced name too now, and that has one deliberate
// consequence beyond the space. Supplying any artifactName sets
// electron-builder's `isUserForced`, which stops it stripping `${arch}`
// from the DEFAULT arch (`expandArtifactNamePattern` in app-builder-lib
// 26.15.7: the arch is nulled only when `!isUserForced`). The x64 AppImage
// therefore stops being un-suffixed and gains its `x86_64` token, so every
// shipped artifact now carries an arch token and §8's coverage gate can
// attribute all of them by name, with no default-arch exception to trust.
// The deb keeps its own Debian naming (`amd64`) below; that is fpm's
// convention, not ours to fight.
const MAC_ARTIFACT = 'xchain-wallet-${version}-${arch}-mac.${ext}';
const DMG_ARTIFACT = 'xchain-wallet-${version}-${arch}.${ext}';
const WIN_ARTIFACT = 'xchain-wallet-${version}-${arch}-win.${ext}';
const NSIS_ARTIFACT = 'xchain-wallet-setup-${version}-${arch}.${ext}';
const APPIMAGE_ARTIFACT = 'xchain-wallet-${version}-${arch}.${ext}';

// --- Windows signing identity (§4, DD2) ---------------------------
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
// With no Azure vars set this block is entirely inert and the classic-cert
// path is used exactly as before. A dev build with no cert config at all
// still produces unsigned artifacts - deliberately, and ONLY when no lane
// declared otherwise (see the requirement check immediately below).
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

// A lane that must ship a SIGNED Windows build fails HERE, by name, rather
// than packing unsigned installers and letting the artifact gate discover it
// at the end of the release. Everything about the environment above is
// silent when it is incomplete: a missing config value drops azureSignOptions
// and falls back to a classic path with no certificate, and the three Entra
// credentials are read by the Azure SDK rather than by this file, so their
// absence is invisible from here entirely.
//
// Opt-in for the same reason `forceCodeSigning` is scoped to the store lane:
// an unsigned dev build is legitimate and must stay quiet, an unsigned
// release build never is. release.yml sets XCHAIN_REQUIRE_WIN_SIGNING=1 on
// every step that builds a Windows artifact, and
// test/smoke/audits/windows-signing-required.smoke.js fails if a step is
// added that does not.
assertWindowsSigningMaterial(process.env);

/** @type {import('electron-builder').Configuration} */
const config = {
    appId: 'io.xchain.wallet.desktop',
    productName: 'XChain Wallet',
    copyright: 'Copyright © Dankest, LLC',

    // A store build that cannot sign must FAIL, not succeed quietly
    //Every macOS signing miss in app-builder-lib is silent by
    // default: `handleNullIdentity` logs and returns false, and a missing
    // certificate goes through `reportError`, which only throws when this
    // flag is on. Both paths end the same way, exit 0 with no .pkg, and
    // that is exactly how this lane read as healthy while producing
    // nothing. Scoped to the store lane because a dev or CI mac build with
    // no certificate at all is a legitimate unsigned build; a Mac App
    // Store build never is.
    forceCodeSigning: buildMas,

    // --- Reproducible AppImage (DD7) ----------------------------
    //
    // The AppImage was the one shipped artifact that did NOT reproduce,
    // because mksquashfs takes TWO timestamps from the wall clock: the
    // per-file mtimes it reads into the inode table, and the squashfs
    // superblock's own mkfs_time. squashfs-tools 4.4 has a flag for each
    // (-all-time, -mkfs-time); the pinned build is 4.3-git (2017) and has
    // neither, so this hook swaps in a wrapper that writes both from
    // SOURCE_DATE_EPOCH. Pinning only the superblock was measured NOT to
    // be enough. See scripts/appimage-toolset.cjs for why the hook is the
    // right seam and scripts/mksquashfs-deterministic.cjs for the patch.
    //
    // Deliberately NOT a step in release.yml or the Dockerfile: a lane
    // that forgets it would publish a non-reproducible AppImage and say
    // nothing, and a lane added later would have to remember. Here it
    // cannot be left out of anything that builds Linux.
    beforePack: async (context) => {
        if (context.electronPlatformName !== 'linux') {
            return;
        }
        const {
            prepareDeterministicAppImageToolset,
        } = require('./scripts/appimage-toolset.cjs');
        await prepareDeterministicAppImageToolset(context.arch);
    },

    // --- The store package lands where nothing looks ---------
    //
    // Every other artifact this config produces is written to `dist/`.
    // The Mac App Store `.pkg` is not: app-builder-lib's
    // `MacTargetHelper.createMasInstaller` resolves the artifact name
    // against the PACK directory it was handed (`path.resolve(outDir,
    // artifactName)` where outDir is `dist/mas-universal`), so the one
    // artifact this channel ships arrives one level below every tool that
    // goes looking for one. Measured with a real signed .pkg on disk:
    // `update-info.mjs artifacts packages/desktop/dist` printed nothing
    // and exited 0, so `xr_list_artifacts` saw an empty set, the
    // `optional  *-mas.pkg` row in expected-artifacts.txt could never
    // match, sign.sh would never sign it and publish.sh would never
    // publish it. An optional row that can never match is
    // indistinguishable from one that simply was not built, which is why
    // this survived six days behind the identity defect above.
    //
    // Fixed HERE rather than in the release tooling deliberately. The
    // alternative is teaching update-info.mjs, lib.sh, sign.sh and
    // publish.sh to look inside pack directories, which is four tools
    // learning one upstream quirk and carrying a path with a slash in it
    // through a manifest that has never held one. Normalising the layout
    // at the seam that creates it leaves every downstream tool reading a
    // flat directory, which is what they were written against.
    //
    // The name cannot be used to do this: createMasInstaller runs the
    // artifactName template through `path.basename`, on purpose, so a
    // `../` in it is stripped rather than honoured.
    // IT ALSO NOTARIZES THE DISK IMAGE (row 140), which is a second
    // job in one hook because this is the only seam that sees a FINISHED
    // dmg. `mac.notarize` runs during afterSign, on the .app, and the dmg
    // is built from that bundle afterwards - so the container itself has
    // no other point at which anything can staple a ticket to it.
    // scripts/notarize-dmg.cjs carries the measurements and the
    // fail-closed reasoning.
    afterAllArtifactBuild: async (buildResult) => {
        const { renameSync } = require('node:fs');
        const { basename, dirname, join, resolve } = require('node:path');
        const { notarizeDmgArtifacts } = require('./scripts/notarize-dmg.cjs');

        const distRoot = resolve(buildResult.outDir);
        const relocated = [];
        for (const file of buildResult.artifactPaths) {
            if (!file.endsWith('.pkg')) continue;
            if (resolve(dirname(file)) === distRoot) continue;
            const destination = join(distRoot, basename(file));
            renameSync(file, destination);
            relocated.push(destination);
        }

        await notarizeDmgArtifacts({
            artifactPaths: buildResult.artifactPaths,
            identity: MAC_IDENTITY,
        });

        // Returned so electron-builder's own artifact list names where the
        // file actually is; the build itself never publishes (§8), so this
        // is bookkeeping rather than an upload. The dmgs are NOT returned:
        // they are already in the artifact list and stapling edits them in
        // place rather than producing a new file.
        return relocated;
    },

    // NOTE: the `homepage` the .deb lane requires is NOT settable here.
    // v26's schema sets additionalProperties:false at the root and
    // rejects it outright ("configuration has an unknown property
    // 'homepage'"), which is the good failure mode. It is app METADATA,
    // so it lives in packages/desktop/package.json; see the comment there.

    // Explicit asar: reduces startup I/O + lets electron-builder
    // write deterministic archive entries. THERE IS ONE NATIVE MODULE,
    // and asar already unpacks it: a Linux install compiles
    // tiny-secp256k1 (root package.json's pnpm onlyBuiltDependencies),
    // and the Linux artifacts ship
    // resources/app.asar.unpacked/node_modules/tiny-secp256k1/build/Release/secp256k1.node
    // (counted it in the release lane's own.deb). It needs no
    // asarUnpack entry because *.node is unpacked by default; a macOS
    // build compiles nothing, which is why this read as "none right
    // now" for as long as it did.
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
    // rebuild step, and NOT because there are no native deps: there is
    // one, and the INSTALL is what compiles it. The Linux artifacts are
    // built by `pnpm install` inside the verifier's pinned container,
    // so electron-builder invoking node-gyp afterwards would recompile
    // that addon outside the pinned toolchain, against timestamps
    // nothing controls. See the `desktop-linux` job in
    // .github/workflows/release.yml ("THE COMPILE HAPPENS AT INSTALL
    // TIME, NOT AT PACKAGE TIME").
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
        // Named EXPLICITLY on every platform, not left to
        // electron-builder's implicit `build/icon.*` lookup. That lookup
        // is silent when it finds nothing: the first real mac lane run
        // (2026-08-01) logged "default Electron icon is used" and shipped
        // an app whose Info.plist read CFBundleIconFile = electron.icns.
        // A missing file now fails the build instead of shipping someone
        // else's logo. Assets + regeneration recipe: build/README.md.
        icon: 'build/icon.icns',
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
            // The App Store channel, added only when a build is actually
            // aimed at it. Unconditional would break every developer and
            // CI mac build that has no Apple Distribution certificate,
            // and a rehearsal build must never carry it: `mas` has no
            // auto-update path, so a staging variant of it exercises
            // nothing (same reasoning as UPDATE_CAPABLE_TARGET).
            // UNIVERSAL, not ARCHES, and that is a constraint before it is a
            // preference (operator decision 2026-08-07, spec dq6). An App
            // Store version carries exactly ONE build, so a per-arch pair is
            // two candidates for one slot rather than a choice the store can
            // serve - unlike the Microsoft Store below, which really does
            // ship an architecture-specific package to each device. The
            // trade is a download roughly twice the size; the alternative was
            // an arm64-only listing, which silently makes "installs the
            // native way on every platform" untrue for every Intel Mac and
            // gives the store no way to offer them anything.
            ...(buildMas ? [{ target: 'mas', arch: ['universal'] }] : []),
        ],
        // Signing identity, resolved at MAC_IDENTITY above: the team
        // qualifier whenever a certificate was supplied, null only when one
        // was not. A build with no certificate produces an unsigned .app,
        // which is fine for dev and rejected by Gatekeeper on user machines.
        identity: MAC_IDENTITY,
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
        // TRUE, and it was FALSE by default for every release before
        // v0.339.0 (row 140). dmg-builder signs the disk image only
        // on `this.options.sign === true` (`out/dmg.js`), so the default
        // shipped a signed, notarized, stapled .app inside a container that
        // `codesign` reported as "not signed at all". Measured on the
        // published v0.338.0 bytes: the bundle assessed as `accepted,
        // source=Notarized Developer ID` and the dmg around it as
        // `rejected: no usable signature`, which is precisely the
        // unidentified-developer warning §14 promises users will not see.
        //
        // Signing alone does not clear Gatekeeper for a downloaded image;
        // the ticket does. `afterAllArtifactBuild` notarizes and staples
        // each dmg and then re-reads the assessment. Null identity stays
        // the unsigned dev case: dmg-builder returns early on it, and the
        // notarize hook makes the same decision from the same value.
        sign: Boolean(MAC_IDENTITY),
        // FALSE by operator decision, 2026-08-03  .
        //
        // At `true` the .dmg was listed in `stable-mac.yml` beside the .zip,
        // and electron-updater has no dmg install path at all: `MacUpdater`
        // swaps from a zip. So the channel pointer advertised an artifact the
        // updater could never use. Nothing broke, because MacUpdater picks the
        // zip regardless - but a feed listing an install path that does not
        // exist is one more thing every reader has to know is untrue, and
        // pointer shape is release shape, so it is far cheaper to settle now
        // than to change it under installed clients later.
        //
        // The .dmg still ships. It stays the file users download and click; it
        // simply stops appearing in the update pointer.
        writeUpdateInfo: false,
    },

    // --- Mac App Store (§13) ------------------------------------
    //
    // A SECOND macOS channel, not a variant of the first. The direct
    // download is Developer ID + hardened runtime + notarization, updating
    // through our own feed. This one is Apple Distribution + App Sandbox +
    // App Review, and the App Store owns updates entirely.
    //
    // EVERY FIELD BELOW IS AN OVERRIDE, AND THAT IS THE POINT. Verified
    // against app-builder-lib 26.15.7 rather than assumed: the mas config
    // is computed as `deepAssign({}, mac, config.mas)` (macPackager
    // getPlatformConfig), so anything set on `mac` silently becomes the
    // default here. Two of those would be actively wrong:
    //
    //   - `mac.entitlements` would sign a store build with the Developer
    //     ID entitlements, which carry NO com.apple.security.app-sandbox
    //     key. The sandbox is the one thing the App Store requires.
    //   - `mac.hardenedRuntime: true` would apply the hardened runtime to
    //     a store build. MacTargetHelper reads it as
    //     `isMas ? config.hardenedRuntime === true : ...`, so the inherited
    //     `true` is honoured. Hardened runtime is the notarization
    //     mechanism, not the store one; the sandbox replaces it.
    //
    // Neither would fail the build. Both would fail at upload or review,
    // which is the expensive place to find out.
    mas: {
        // WITHOUT THIS the store .pkg inherits mac.artifactName and lands
        // as `...-x64-mac.pkg`, which reads as a direct-download artifact
        // and sits in the same directory as one. §7.5 already had to fix
        // the cost of identically-shaped, differently-destined files; do
        // not reintroduce it on a channel whose whole point is that it
        // goes somewhere else.
        artifactName: 'xchain-wallet-${version}-${arch}-mas.${ext}',
        entitlements: 'build/entitlements.mas.plist',
        entitlementsInherit: 'build/entitlements.mas.inherit.plist',
        hardenedRuntime: false,
        // THE THIRD INSTANCE OF THE INHERITANCE TRAP, and the one that made
        // this lane produce nothing at all. Without this line the
        // store build inherits `mac.identity`, which is null on any machine
        // holding no certificate, and a null identity short-circuits
        // signing before `createMasInstaller` - the only thing that emits a
        // .pkg. It does not fail: it logs "skipped macOS code signing" and
        // exits 0 with no artifact, which is why six days of "the lane is
        // built, it just needs certificates" was wrong. See MAS_IDENTITY
        // above for why the value is a team qualifier and not a cert name.
        identity: MAS_IDENTITY,
        // Apple issues this per app id; it is not a secret but it IS
        // account-specific, so it stays env-driven like every other
        // credential here. Absent, electron-builder passes "none" and the
        // signature is unusable for the store - fine for a local
        // `mas-dev` smoke, never for a submission.
        provisioningProfile: process.env.MAS_PROVISIONING_PROFILE || null,
        // The store lists by category; this mirrors mac.category.
        category: 'public.app-category.finance',
    },

    // --- Windows -------------------------------------------------------
    win: {
        artifactName: WIN_ARTIFACT,
        // See the mac.icon comment: explicit on every platform.
        icon: 'build/icon.ico',
        // The store target is appended OUTSIDE the staging ternary on
        // purpose. Written inside the production branch, `buildAppx`'s own
        // `&& !isStaging` would be unreachable - the ternary already
        // excludes it - so the guard would read as protection while doing
        // nothing, and widening the staging branch later would silently
        // start emitting store packages into the rehearsal tree. Out here,
        // that flag is the only thing keeping appx out of a staging build,
        // which is what the smoke can then actually check.
        target: [
            ...(isStaging ? UPDATE_CAPABLE_TARGET.win : [
                { target: 'nsis', arch: ARCHES },
                { target: 'zip', arch: ARCHES },
            ]),
            // The Microsoft Store channel, added only when a build is
            // actually aimed at it (see buildAppx).
            ...(buildAppx ? [{ target: 'appx', arch: ARCHES }] : []),
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
        // TWO INSTALLERS, ONE PER ARCH. NOT THREE (operator
        // decision 2026-08-01, reversing the same day's earlier call to
        // publish all three).
        //
        // By default electron-builder ALSO emits an un-suffixed installer
        // carrying both architectures - 193M against 113M and 96M - which
        // was found on the first successful Windows build and is easy to
        // miss, because `expected-artifacts.txt` matched `*.exe` by
        // extension and all three satisfied it equally.
        //
        // This suppresses it at the source rather than deleting it after
        // the fact, and the difference matters: with the flag false,
        // `NsisTarget.build()` builds each arch's installer as that arch
        // finishes and never accumulates a multi-arch set, so there is no
        // 193M file to forget to delete, to publish by accident, or to
        // explain on the download page. A post-build `rm` would have to be
        // remembered by every lane, which is the shape of defect this
        // release tooling keeps finding.
        //
        // The gate is the backstop, not the mechanism: `*.exe` declares
        // `x64,arm64` with no `multi`, so if this ever flips back, the
        // un-suffixed installer fails signing as UNATTRIBUTED rather than
        // quietly reappearing on the feed.
        buildUniversalInstaller: false,
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        perMachine: false,
        deleteAppDataOnUninstall: false,
        // Deterministic uninstaller name; the default injects a timestamp.
        uninstallDisplayName: '${productName}',
        // Differential updates are a non-goal (§7), so do not emit
        // the delta metadata for them. This also stops the channel pointer
        // (`stable.yml` on Windows - never `latest.yml`, which is the
        // default channel's name and not ours) from advertising a
        // blockMapSize for a file we deliberately do not publish.
        // NOTE: this only covers nsis. A blockmap is produced whenever
        // update info is written, and there is no opt-out in
        // app-builder-lib, so the `rm -f *.blockmap` step in release.yml
        // is load-bearing rather than belt-and-braces.
        //
        // MEASURED on a real mac build 2026-08-02, because "the macOS zip
        // blockmap" undercounted it: the lane emits FOUR, one per zip AND
        // one per dmg. The dmg ones exist because `dmg.writeUpdateInfo`
        // is true below, which also puts both dmg files in
        // `stable-mac.yml` even though electron-updater can never offer
        // one (MacUpdater selects with `findFile(files, "zip", ["pkg",
        // "dmg"])`). Harmless, and registered rather than
        // changed here, because it alters what a published pointer
        // contains.
        differentialPackage: false,
    },

    // --- Microsoft Store (§15) ----------------------------------
    //
    // A SECOND Windows channel, not a variant of the first. The direct
    // download is an Authenticode-signed NSIS installer hosted by us and
    // updated through our own feed; this is an MSIX/AppX package signed by
    // Microsoft at ingestion and updated by the Store.
    //
    // THE ONE THING THAT IS EASIER HERE THAN ON macOS: this is not a
    // sandbox. AppxTarget writes `Windows.FullTrustApplication` as the
    // entry point and auto-adds the `runFullTrust` capability (verified in
    // app-builder-lib 26.15.7), so the hardware-signer question that
    // decides whether the Mac App Store channel ships at all (§13) does
    // not arise in the same form: a full-trust MSIX app reaches WebHID
    // devices the way the unpackaged app does. It still gets filesystem
    // and registry virtualization, which is a VAULT-LOCATION question and
    // is recorded as such in §15 rather than assumed away.
    //
    // SAME INHERITANCE TRAP AS `mas`, and it bites here too: AppxTarget
    // computes its options as `deepAssign({}, win, config.appx)`, so
    // `win.artifactName` would name a store package
    // `xchain-wallet-<v>-x64-win.appx` - our direct-download convention,
    // on the one artifact that must never be mistaken for a hosted file.
    appx: {
        artifactName: 'xchain-wallet-${version}-${arch}-appx.${ext}',

        // IDENTITY IS ASSIGNED BY PARTNER CENTER, AND EVERY DEFAULT HERE
        // IS WRONG IN A DIFFERENT WAY.
        //
        // `identityName` defaults to the package.json name, which is
        // `@xchain-wallet/desktop`. AppX identity must be alphanumeric,
        // period and dash only, 3-50 characters, so that default fails the
        // manifest write outright - the same shape as the Linux
        // `executableName` defect in §5, and the same good failure mode.
        //
        // `publisher` is worse, because its default SUCCEEDS. With no
        // code-signing certificate present, `computePublisherName` returns
        // the literal string `CN=ms` and logs "AppX is not signed"; with a
        // certificate present but no explicit publisher, it uses that
        // CERTIFICATE's subject, which is the Authenticode identity and
        // not necessarily the Store one. Either way the package builds and
        // is then rejected at ingestion for an identity mismatch, which is
        // the expensive place to learn it.
        //
        // Both are env-driven because both are account-specific values
        // nobody holds yet (ceremony A). The defaults below are valid
        // shapes so a local smoke can build; they are NOT submission
        // values, and §15 says so in the same words.
        identityName: process.env.APPX_IDENTITY_NAME || 'DankestLLC.XChainWallet',
        publisher: process.env.APPX_PUBLISHER || null,
        publisherDisplayName: 'Dankest, LLC',
        applicationId: 'XChainWallet',
        languages: ['en-US'],

        // Explicit rather than inherited from the auto-add, so that the
        // capability set is reviewable in one place and a future addition
        // has to be written down. `runFullTrust` is obligatory for an
        // Electron app; nothing else is requested, and in particular no
        // broadFileSystemAccess, which is a Store review flag.
        capabilities: ['runFullTrust'],

        // The tile background behind the logo, brand accent
        // (--xc-accent-primary). electron-builder's default is #464646.
        backgroundColor: '#1A7BAC',

        // Store submissions require the fourth version part to be 0, which
        // is what electron-builder produces with this off. Turning it on
        // sets a build number there and the submission is refused.
        setBuildNumber: false,
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
        // See the mac.icon comment: explicit on every platform. Linux
        // takes the PNG master and electron-builder derives the sizes the
        // .desktop entry and the AppImage need.
        icon: 'build/icon.png',
        // The store target is appended OUTSIDE the staging ternary, same
        // reasoning as win/appx: inside the production branch, buildSnap's
        // own `&& !isStaging` would be unreachable and would read as
        // protection while doing nothing. Out here, that flag is the only
        // thing keeping the snap out of a staging build, which is what the
        // smoke can then actually check.
        target: [
            ...(isStaging ? UPDATE_CAPABLE_TARGET.linux : [
                { target: 'AppImage', arch: ARCHES },
                { target: 'deb', arch: ARCHES },
            ]),
            // The Snap Store channel, added only when a build is actually
            // aimed at it (see buildSnap).
            ...(buildSnap ? [{ target: 'snap', arch: ARCHES }] : []),
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
        // Named like every other artifact (§7.1). Forcing it here is also
        // what gives the x64 AppImage its `x86_64` token: until now this
        // was the ONE target left at the default pattern, so its x64 build
        // was un-suffixed and §8's arch gate had to carry a special case
        // reading a bare `.AppImage` as x64. With the name forced, that
        // exception is gone and an un-suffixed AppImage is what it should
        // be, an artifact the gate refuses to attribute - the same posture
        // as the combined NSIS installer  .
        artifactName: APPIMAGE_ARTIFACT,
        // SOURCE_DATE_EPOCH ALONE IS NOT ENOUGH HERE, and this comment
        // once claimed it was. Measured 2026-08-01: two packaged builds of
        // one commit, one epoch, one container produced byte-DIFFERENT
        // AppImages on both arches while the .deb files from the same runs
        // were byte-identical. The squashfs superblock (validated v4.0 at
        // offset 188392, block_size 131072) said why:
        //
        //   mkfs_time         = 1785618191  (build wall clock)
        //   SOURCE_DATE_EPOCH = 1785601315  (the commit's author date)
        //
        // mksquashfs writes that field from the clock, and the pinned
        // build of it (4.3-git, 2017) predates every flag that would say
        // otherwise. Fixed by the `beforePack` hook at the top of this
        // file, which substitutes a mksquashfs wrapper that writes the
        // epoch into the superblock before anything downstream hashes the
        // image. The AppImage now reproduces byte-for-byte.
        //
        // Do not remove that hook, and do not restore any claim about this
        // artifact - in either direction - without re-running the two-build
        // comparison. This one survived unmeasured for months.
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
        // This was once the ONLY target with a pinned name, because its
        // default was structurally broken. Since §7.1's rename every target
        // is pinned and none carries a space; the deb keeps fpm's own
        // `_<version>_<arch>` shape rather than our `-` convention, because
        // that shape is Debian's and not ours to choose.
        artifactName: 'xchain-wallet_${version}_${arch}.${ext}',
        // Pin compression + omit non-deterministic build fields.
        // fpm (which electron-builder invokes) respects SOURCE_DATE_EPOCH
        // for ar-archive mtimes.
        compression: 'xz',
    },

    // --- Snap Store (§16) ------------------------------
    //
    // A THIRD Linux channel, not a variant of the other two. The AppImage
    // and .deb are hosted by us and updated through our own feed; the
    // .snap is signed by store assertions, served by the Snap Store
    // (Ubuntu's default App Center), and updated by snapd's auto-refresh.
    // The app must not self-update in this channel: main/updater.js
    // short-circuits on the SNAP env vars snapd sets, because unlike MAS
    // and MSIX, Electron has no process flag for a snap build.
    //
    // SnapTarget computes its options as
    // `deepAssign({}, linux, snapcraft ?? snap)` (verified against this
    // app-builder-lib 26.15.7) - the same inheritance shape as mas/appx.
    //
    // `artifactName` IS PINNED FOR THE SAME REASON AS THE DEB'S: the
    // default is `${name}_${version}_${arch}.${ext}` and `${name}` is the
    // scoped package.json name `@xchain-wallet/desktop`, so the default
    // contains a SLASH and writes the artifact into a subdirectory nothing
    // looks in. Snap arch names follow Debian's (`amd64`/`arm64`,
    // getArtifactArchName in builder-util), so both files carry an arch
    // token §8's gate can attribute.
    //
    // `base: 'core24'` selects the maintained strategy in this fork (the
    // flat legacy `snap` key is deprecated and its prebuilt-template fast
    // path covers x64 only, which cannot serve a two-arch matrix).
    //
    // STRICT CONFINEMENT IS A DECISION WITH A SHIP-RISK ATTACHED (§16):
    // it is what passes automated store review, and it is a real sandbox,
    // so whether Ledger/Trezor remain reachable over WebHID inside it is
    // unproven until tested on real hardware. `raw-usb` and `u2f-devices`
    // are declared for exactly that test - declaring a plug is free and
    // passes automated review; what needs Store approval is AUTO-connect,
    // and until granted a user can `snap connect` manually. `classic`
    // confinement is the escape hatch and a last resort: it forfeits
    // automated review and the isolation story both.
    //
    // No store credential appears here. Publishing auth is SNAP_CSC_LINK /
    // SNAPCRAFT_STORE_CREDENTIALS in the environment (release.yml), never
    // config, where it would land in builder-effective-config.yaml.
    snapcraft: {
        base: 'core24',
        artifactName: 'xchain-wallet_${version}_${arch}.${ext}',
        core24: {
            confinement: 'strict',
            grade: 'stable',
            // Max 78 chars; defaults to productName, which is a name, not
            // a summary. Matches linux.synopsis.
            summary: 'Self-custodial multi-chain XChain Platform wallet',
            // The standard Electron plug set, plus the two interfaces the
            // hardware-signer test needs (see the block comment above).
            //
            // `browser-support` MUST BE RESTATED HERE, WITH allow-sandbox.
            // Supplying ANY explicit plugs list turns off app-builder-lib's
            // automatic injection of it ("they are responsible for
            // including browser-support in that case", core24.js), and
            // `'default'` expands to a set that does NOT contain it. The
            // failure is not a crash: without allow-sandbox the generated
            // launcher appends `--no-sandbox`, so the wallet would ship
            // with Chromium's own sandbox OFF - a silent security
            // downgrade, found by reading isBrowserSandboxAllowed() rather
            // than by any build error.
            plugs: [
                'default',
                { 'browser-support': { interface: 'browser-support', 'allow-sandbox': true } },
                'raw-usb',
                'u2f-devices',
            ],
        },
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
    // (§7.1).
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
