// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  §4 / stage 2: the shape of the desktop signing config
// after the electron-builder v25 -> v26 upgrade.
//
// WHY A TEST AND NOT JUST THE UPGRADE. v26 moved every signtool setting
// from `win.*` into `win.signtoolOptions.*`. Reverting to the old layout
// fails LOUDLY - verified against 26.15.7 by building with a v25-shaped
// config, which is rejected at schema validation before any packing - so
// this file is not guarding against a silent drop. It guards the VALUES
// inside the new layout, which nothing else pins: `publisherName` is what
// electron-updater matches an update's Authenticode publisher against, so
// losing or changing it degrades the update chain on already-shipped
// wallets, and no build log would mention it.
//
// The second thing pinned here IS a silent failure. Per upstream's own
// doc comment, setting both `signtoolOptions` and `azureSignOptions` does
// not error - it quietly defaults to Azure. So "which signing path is
// this build on" must be decidable from the config alone, and exactly one
// key may ever be present.

import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const require = createRequire(import.meta.url);
const CONFIG = join(root, 'packages/desktop/electron-builder.config.cjs');

// The pinned certificate subject CN (§4). Changing this is a migration
// event for every installed Windows wallet, not a rename.
const PUBLISHER = 'Dankest, LLC';

const AZURE_VARS = {
    AZURE_CODE_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net/',
    AZURE_CODE_SIGNING_NAME: 'xchain-signing',
    AZURE_CERT_PROFILE_NAME: 'xchain-profile',
};
const OWNED_VARS = [...Object.keys(AZURE_VARS), 'APPLE_API_KEY_ID', 'APPLE_TEAM_ID',
    'XCHAIN_STAGING_FEED_URL'];

const STAGING_URL = 'https://downloads.xchain.io/wallet/_rehearsal-7f3a91c2/desktop/';

/** Load the config fresh under a given environment. */
function loadConfig(env = {}) {
    const saved = {};
    for (const k of OWNED_VARS) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
    Object.assign(process.env, env);
    try {
        delete require.cache[require.resolve(CONFIG)];
        return require(CONFIG);
    } finally {
        for (const k of OWNED_VARS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
        delete require.cache[require.resolve(CONFIG)];
    }
}

// ------------------------------------------------- classic-cert default

{
    const cfg = loadConfig();

    assert.ok(cfg.win.signtoolOptions,
        'with no Azure env the classic signtool path is configured');
    assert.equal(cfg.win.azureSignOptions, undefined,
        'azureSignOptions is absent unless the Azure env is complete');

    assert.equal(cfg.win.signtoolOptions.publisherName, PUBLISHER,
        'publisherName is pinned inside signtoolOptions (electron-updater matches on it)');
    assert.deepEqual(cfg.win.signtoolOptions.signingHashAlgorithms, ['sha256'],
        'sha256 only');
    assert.equal(cfg.win.signtoolOptions.rfc3161TimeStampServer,
        'http://timestamp.digicert.com',
        'the RFC 3161 timestamp server stays pinned, so signatures outlive the cert');

    // The v25 layout. v26 rejects these at schema validation, so this
    // loop is a fast local signal rather than the only line of defence.
    for (const dead of ['publisherName', 'signingHashAlgorithms', 'rfc3161TimeStampServer',
        'certificateFile', 'certificatePassword', 'timeStampServer']) {
        assert.equal(cfg.win[dead], undefined,
            `win.${dead} is not at the v25 top level (v26 rejects that config outright)`);
    }
}

// -------------------------------------------------- Azure Trusted Signing

{
    const cfg = loadConfig(AZURE_VARS);

    assert.ok(cfg.win.azureSignOptions,
        'a complete Azure env selects Azure Trusted Signing (rails D3 / DD2)');
    assert.equal(cfg.win.signtoolOptions, undefined,
        'signtoolOptions is absent on the Azure path: setting both silently defaults to Azure');

    assert.equal(cfg.win.azureSignOptions.publisherName, PUBLISHER,
        'the same pinned publisher CN on both signing paths, so switching is not a fleet break');
    assert.equal(cfg.win.azureSignOptions.endpoint, AZURE_VARS.AZURE_CODE_SIGNING_ENDPOINT);
    assert.equal(cfg.win.azureSignOptions.codeSigningAccountName,
        AZURE_VARS.AZURE_CODE_SIGNING_NAME);
    assert.equal(cfg.win.azureSignOptions.certificateProfileName,
        AZURE_VARS.AZURE_CERT_PROFILE_NAME);

    // The credentials belong to the Azure SDK's own env contract; they
    // must never be copied into the build config, where they would end up
    // in `builder-effective-config.yaml`.
    const serialised = JSON.stringify(cfg);
    for (const secretish of ['AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID']) {
        assert.ok(!serialised.includes(secretish),
            `${secretish} is not referenced in the build config`);
    }
}

// The endpoint is required by the v26 type and region-specific. A partial
// Azure env must fall back cleanly rather than emit an invalid block.
{
    const partial = { ...AZURE_VARS };
    delete partial.AZURE_CODE_SIGNING_ENDPOINT;
    const cfg = loadConfig(partial);
    assert.equal(cfg.win.azureSignOptions, undefined,
        'an Azure env missing the endpoint does not produce a half-built azureSignOptions');
    assert.ok(cfg.win.signtoolOptions,
        'it falls back to the classic path instead');
}

// ------------------------------------------------------------ macOS

{
    const off = loadConfig();
    assert.equal(typeof off.mac.notarize, 'boolean',
        'mac.notarize is a boolean in v26; the v25 { teamId } object is no longer valid');
    assert.equal(off.mac.notarize, false, 'no Apple credentials means no notarization step');

    const on = loadConfig({ APPLE_API_KEY_ID: 'ABCD1234', APPLE_TEAM_ID: 'TEAM123456' });
    assert.equal(on.mac.notarize, true, 'Apple credentials switch notarization on');
    assert.equal(typeof on.mac.notarize, 'boolean',
        'still a boolean with credentials present - teamId now comes from APPLE_TEAM_ID');

    assert.equal(off.mac.hardenedRuntime, true,
        'hardened runtime stays on; notarization requires it');
}

// ------------------------------------------------------------- targets

{
    const cfg = loadConfig();

    // Differential updates are a non-goal ( §7). nsis can be told
    // not to emit delta metadata; the macOS zip blockmap cannot (see the
    // note in the config), which is why release.yml still deletes them.
    assert.equal(cfg.nsis.differentialPackage, false,
        'nsis emits no delta metadata');

    // The §2 matrix: 6 shipped lanes, no 32-bit anywhere.
    const arches = (targets) => targets.flatMap((t) => t.arch);
    for (const [os, targets] of [['win', cfg.win.target], ['mac', cfg.mac.target]]) {
        assert.deepEqual([...new Set(arches(targets))].sort(), ['arm64', 'x64'],
            `${os} ships x64 + arm64 only (§2: no ia32, no armv7l)`);
    }
    assert.deepEqual([...new Set(arches(cfg.linux.target))].sort(), ['arm64', 'x64'],
        'linux ships x64 + arm64; armv7l is post-launch on demand (DD1)');

    //  DD4: every artifact name carries its arch.
    //
    // This is update correctness, not cosmetics. electron-updater selects an
    // artifact by substring-matching `process.arch` against the filename and
    // falls back to whichever file is listed FIRST. electron-builder omits
    // the arch from x64 names unless an artifactName is supplied, so without
    // these the x64 lane is correct only while x64 happens to be built
    // first: reverse the order and every x64 user is served the arm64 build.
    // Proven against the real selector in
    // test/unit/desktop/updaterArchSelection.test.js.
    for (const [what, pattern] of [
        ['mac', cfg.mac.artifactName],
        ['dmg', cfg.dmg.artifactName],
        ['win', cfg.win.artifactName],
        ['nsis', cfg.nsis.artifactName],
    ]) {
        assert.ok(pattern, `${what} sets an explicit artifactName`);
        assert.ok(pattern.includes('${arch}'),
            `${what} artifactName carries \${arch}, so x64 names are not arch-less`);
    }

    // The platform markers expected-artifacts.txt matches on must survive.
    assert.ok(cfg.mac.artifactName.includes('-mac.'),
        'the mac zip stays distinguishable from the win zip (*mac*.zip)');
    assert.ok(cfg.win.artifactName.includes('-win.'),
        'the win zip stays distinguishable from the mac zip (*win*.zip)');

    // Linux is deliberately left alone: one update-info file per arch means
    // each yml lists only its own arch, so there is no selection to get
    // wrong, and deb has its own Debian arch naming (amd64) to respect.
    assert.equal(cfg.linux.artifactName, undefined,
        'linux keeps electron-builder defaults (per-arch ymls, no ambiguity)');

    // Stage 1's contract, re-checked here because the upgrade touched this file.
    assert.equal(cfg.publish[0].channel, 'stable');
    assert.equal(cfg.publish[0].url, 'https://downloads.xchain.io/wallet/desktop/');
    assert.equal(cfg.directories.output, 'dist');
}

// -------------------------------------------- §7.5 rehearsal variants

{
    const cfg = loadConfig({ XCHAIN_STAGING_FEED_URL: STAGING_URL });

    assert.equal(cfg.publish[0].url, STAGING_URL,
        'a rehearsal build bakes the staging feed');
    assert.equal(cfg.publish[0].channel, 'staging',
        'and the staging channel, so it reads staging*.yml and never the live pointer');

    // Separate output directory. electron-builder names artifacts by
    // VERSION, not channel, so a staging zip and a prod zip are
    // byte-different twins under the same filename. Sharing a directory
    // would let a staging binary be signed and published as the real one.
    assert.equal(cfg.directories.output, 'dist-staging',
        'rehearsal artifacts build to their own directory');

    // Update-capable format ONLY, per OS. Enforced in the config because
    // the CLI form does not do it: a `--mac zip` run was observed building
    // the dmg as well, which would have put non-update-capable formats in
    // the rehearsal set and listed them in the staging pointer.
    assert.deepEqual(cfg.mac.target.map((t) => t.target), ['zip'],
        'macOS rehearses the zip (electron-updater never swaps the dmg)');
    assert.deepEqual(cfg.win.target.map((t) => t.target), ['nsis'],
        'Windows rehearses nsis (the zip has no auto-update path)');
    assert.deepEqual(cfg.linux.target.map((t) => t.target), ['AppImage'],
        'Linux rehearses the AppImage (deb has no in-place swap)');

    for (const [os, targets] of [['mac', cfg.mac.target], ['win', cfg.win.target],
        ['linux', cfg.linux.target]]) {
        assert.deepEqual(targets.flatMap((t) => t.arch).sort(), ['arm64', 'x64'],
            `${os} rehearses both shipped arches (per-arch resolution is its own failure surface)`);
    }
}

// A production build must be untouched by any of that. This is the
// §7.5 rule that production carries no feed-override affordance: the
// staging variable is a BUILD-TIME input, and with it unset the config is
// identical to one written before staging existed.
{
    const prod = loadConfig();
    assert.equal(prod.publish[0].channel, 'stable');
    assert.equal(prod.directories.output, 'dist');
    assert.deepEqual(prod.mac.target.map((t) => t.target), ['dmg', 'zip']);
    assert.deepEqual(prod.win.target.map((t) => t.target), ['nsis', 'zip']);
    assert.deepEqual(prod.linux.target.map((t) => t.target), ['AppImage', 'deb']);
}

console.log('desktop-build-config smoke: ok');
