// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  §7.1: channel-pointer naming and classification.
//
// The failure this guards is the quietest one in the whole release path.
// If the feed serves update-info files under names the installed wallets
// do not request - or the release tooling never recognises them as
// pointers and so never uploads them - then absolutely nothing errors.
// The build is green, the artifacts are signed, the manifest verifies,
// the feed looks populated, and every wallet in the field is simply never
// offered another update, forever. There is no log line for it. So the
// naming rule is pinned here against the electron-builder actually
// installed, and the classifier is driven against real fixtures.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import { classify, isUpdateInfoContent, parseFlatYaml, readBundledFeedConfigs, readPublishConfig }
    from '../../../tools/release/update-info.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const require = createRequire(import.meta.url);

// The pointer set the shipped §2 matrix must produce at channel `stable`.
// Four files, not three: non-x64 Linux is arch-suffixed, and that fourth
// name is the one a hand-written checklist drops, stranding the whole
// linux-arm64 fleet.
const EXPECTED_POINTERS = [
    'stable.yml',
    'stable-mac.yml',
    'stable-linux.yml',
    'stable-linux-arm64.yml',
];

// ------------------------------------------- the rule, pinned upstream

// getUpdateInfoFileName() lives in app-builder-lib, not in our repo, so a
// major bump can change it under us. Re-derive it from the installed
// source and check it still says what §7.1 claims. This is the check that
// makes "re-verify on every Electron/builder major bump" an automated
// step rather than a line in a document nobody re-reads.
{
    const builderPkg = require.resolve('app-builder-lib/package.json');
    const src = readFileSync(join(dirname(builderPkg), 'out/publish/updateInfoBuilder.js'), 'utf8');

    assert.ok(/function getUpdateInfoFileName\(channel, packager, arch\)/.test(src),
        'app-builder-lib still names update-info files via getUpdateInfoFileName(channel, ...)');

    // The channel, not the word "latest", is the filename stem.
    assert.ok(/return `\$\{channel\}\$\{osSuffix\}\$\{getArchPrefixForUpdateFile\(arch, packager\)\}\.yml`/
        .test(src),
    'update-info filename is <channel><osSuffix><archSuffix>.yml');

    // Windows gets no OS suffix; the other two are keyed off the platform.
    assert.ok(/const osSuffix = packager\.platform === core_1\.Platform\.WINDOWS \? "" :/.test(src),
        'Windows update-info has no OS suffix (so ours is plain stable.yml)');

    // Arch suffix ONLY on Linux, and only off x64. This is the clause the
    // spec's `-armv7l` guess got wrong: upstream writes `-arm`.
    assert.ok(/if \(arch == null \|\| arch === builder_util_1\.Arch\.x64 \|\| packager\.platform !== core_1\.Platform\.LINUX\)/
        .test(src),
    'only non-x64 Linux update-info files carry an arch suffix');
    assert.ok(/return arch === builder_util_1\.Arch\.armv7l \? "-arm" : `-\$\{builder_util_1\.Arch\[arch\]\}`/
        .test(src),
    'armv7l suffixes as "-arm", every other arch as its own name (arm64 -> -arm64)');

    // At channel `stable` exactly one channel's files are emitted; the
    // alpha/beta fan-out is reachable only from the `latest` default.
    assert.ok(/case "latest":\s*\n\s*return \[currentChannel, "alpha", "beta"\]/.test(src),
        'the alpha/beta fan-out belongs to the `latest` channel, not ours');
}

// The config the rule is applied to. If someone changes the channel, the
// expected pointer names above change with it, and this fails first.
{
    // Pinned on the CONSTANTS, not on the publish block: since stage 3 the
    // block picks its feed at build time (prod, or staging for a §7.5
    // rehearsal), so the literals live in named constants above it.
    const cfg = readFileSync(join(root, 'packages/desktop/electron-builder.config.cjs'), 'utf8');
    assert.ok(/const PROD_CHANNEL = 'stable';/.test(cfg),
        'desktop publishes on channel `stable` (the §7.1 pointer names assume it)');
    assert.ok(/const PROD_FEED_URL = 'https:\/\/downloads\.xchain\.io\/wallet\/desktop\/';/.test(cfg),
        'desktop publishes to the downloads.xchain.io feed');
}

// Nothing in the release path may go back to globbing for `latest`.
// Matched on the shell glob form specifically: both files explain the
// old bug in prose, and that explanation is the reason the bug does not
// come back, so it must not trip the check that it stayed fixed.
for (const p of ['tools/release/lib.sh', 'tools/release/publish.sh']) {
    const src = readFileSync(join(root, p), 'utf8');
    assert.ok(!/-name\s+'latest\*\.yml'/.test(src),
        `${p} does not glob for latest*.yml (matches nothing at channel stable)`);
}

// ------------------------------------------------------ the classifier

assert.ok(isUpdateInfoContent(
    'version: 1.0.0\nfiles:\n  - url: a.dmg\n    sha512: x\npath: a.dmg\nsha512: x\n'),
'a real update-info file is recognised');

// builder-debug.yml really does sit in dist/ next to the pointer. A
// `*.yml` glob would have published electron-builder's debug dump.
assert.ok(!isUpdateInfoContent('x64:\n  firstOrDefaultFilePatterns:\n    - \'!**/node_modules\'\n'),
    'builder-debug.yml is not mistaken for a channel pointer');
assert.ok(!isUpdateInfoContent('version: 9.9.9\n'),
    'a bare version: line is not enough to call something a channel pointer');
assert.ok(!isUpdateInfoContent(''), 'empty content is not a channel pointer');
// Nested keys must not count: only column-0 keys are the top-level mapping.
assert.ok(!isUpdateInfoContent('files:\n  version: 1\n  path: a\n  sha512: b\n'),
    'indented keys do not make a file look like update-info');

{
    const dir = mkdtempSync(join(tmpdir(), 'xc998-classify-'));
    try {
        const pointer = 'version: 1.0.0\npath: a.dmg\nsha512: x\n';
        for (const n of EXPECTED_POINTERS) writeFileSync(join(dir, n), pointer);
        writeFileSync(join(dir, 'builder-debug.yml'), 'x64:\n  a: b\n');
        writeFileSync(join(dir, 'XChain Wallet-1.0.0.dmg'), 'bytes');
        writeFileSync(join(dir, 'RELEASE_HASHES.txt'), '# manifest\n');
        writeFileSync(join(dir, 'RELEASE_HASHES.txt.asc'), 'sig\n');
        mkdirSync(join(dir, 'mac-arm64'));

        const c = classify(dir);
        assert.deepEqual(c.pointers.slice().sort(), EXPECTED_POINTERS.slice().sort(),
            'every arch-suffixed pointer is found, including stable-linux-arm64.yml');
        assert.deepEqual(c.artifacts, ['XChain Wallet-1.0.0.dmg'],
            'artifacts exclude pointers, manifest files and byproducts');
        assert.deepEqual(c.byproducts, ['builder-debug.yml'],
            'builder-debug.yml is a byproduct, never published');
        assert.deepEqual(c.manifest.slice().sort(),
            ['RELEASE_HASHES.txt', 'RELEASE_HASHES.txt.asc'],
            'the manifest and its signature are not artifacts of themselves');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// ----------------------------------------------- the packaged feed config

assert.deepEqual(
    parseFlatYaml("provider: generic\nurl: https://x/\nchannel: stable\n"
        + "updaterCacheDirName: '@xchain-walletdesktop-updater'\n"),
    {
        provider: 'generic',
        url: 'https://x/',
        channel: 'stable',
        updaterCacheDirName: '@xchain-walletdesktop-updater',
    },
    'app-update.yml parses, quotes stripped');

{
    // A packaged app is a bundle-shaped tree; the reader has to find the
    // copy inside it, because that is the copy the shipped binary reads.
    const dir = mkdtempSync(join(tmpdir(), 'xc998-bundle-'));
    try {
        const res = join(dir, 'mac-arm64', 'XChain Wallet.app', 'Contents', 'Resources');
        mkdirSync(res, { recursive: true });
        writeFileSync(join(res, 'app-update.yml'),
            'provider: generic\nurl: https://downloads.xchain.io/wallet/desktop/\nchannel: stable\n');

        const found = readBundledFeedConfigs(dir);
        assert.equal(found.length, 1, 'the bundled app-update.yml is found inside the .app');
        assert.equal(found[0].config.channel, 'stable');
        assert.equal(found[0].config.url, 'https://downloads.xchain.io/wallet/desktop/');

        assert.deepEqual(readBundledFeedConfigs(join(dir, 'nope')), [],
            'a missing directory reads as no configs, not a throw');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// ------------------------------------------------------------- wiring

// The release lanes must collect the pointers. Without these globs the
// lane uploads binaries nothing points at, and the release reaches nobody.
{
    const wf = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
    const lanes = wf.split(/^  desktop-/m).slice(1);
    assert.equal(lanes.length, 3, 'three desktop lanes (linux, macos, windows)');
    for (const lane of lanes) {
        const name = lane.split(':')[0];
        assert.ok(/packages\/desktop\/dist\/\*\.yml/.test(lane),
            `desktop-${name} uploads its channel pointer`);
        assert.ok(/rm -f packages\/desktop\/dist\/\*\.blockmap packages\/desktop\/dist\/builder-debug\.yml/
            .test(lane),
        `desktop-${name} drops builder-debug.yml before that glob picks it up`);
        assert.ok(/update-info\.mjs assert-feed/.test(lane),
            `desktop-${name} asserts the packaged app-update.yml feed + channel`);
        // The expected values are read from the builder config, never
        // written here: release.yml must not name the feed at all (the
        // no-publish guard in release-ci.smoke.js), and a workflow that
        // can name it is one edit from uploading to it.
        assert.ok(/--from-config packages\/desktop\/electron-builder\.config\.cjs/.test(lane),
            `desktop-${name} takes the expected feed from the config, not a literal`);
        assert.ok(!/downloads\.xchain\.io/.test(lane),
            `desktop-${name} does not name the feed URL`);

        //  §7.5 rehearsal variant. Built from the SAME lane so it
        // uses the same toolchain and the same signing identity, into its
        // own output directory, and uploaded under its own artifact name so
        // it can never be mistaken for release output.
        assert.ok(/dist-staging/.test(lane),
            `desktop-${name} builds its rehearsal variant into dist-staging`);
        assert.ok(/assert-feed packages\/desktop\/dist-staging/.test(lane),
            `desktop-${name} asserts the rehearsal variant points at the STAGING feed`);
        assert.ok(new RegExp(`name: desktop-${name}-rehearsal`).test(lane),
            `desktop-${name} uploads the rehearsal set separately from the release set`);
        assert.ok(/XCHAIN_STAGING_FEED_URL: \$\{\{ secrets\./.test(lane),
            `desktop-${name} takes the staging feed from a secret, not a literal`);
    }
}

//  §8 hard rules that live in this file.
{
    const wf = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');

    // Tag control. Under D6 the environment approval comes from the same
    // GitHub account that pushes the tag, so the tag signature is the only
    // release control independent of that account.
    assert.ok(/git verify-tag/.test(wf),
        'the release verifies the tag is GPG-signed before any lane runs');
    assert.ok(/VALIDSIG \$\{EXPECTED\}/.test(wf),
        'and binds it to the pinned fingerprint: verify-tag alone passes for ANY key in the keyring');
    assert.ok(/tag-signing-fingerprint\.txt/.test(wf),
        'the expected fingerprint is pinned in the repo');

    // Every lane, including Windows, must pin the clock. This was missing
    // on the Windows lane, which made its artifacts unreproducible while
    // the other two looked fine.
    const laneCount = (wf.match(/Pin SOURCE_DATE_EPOCH to the tag commit/g) || []).length;
    assert.equal(laneCount, 4,
        'all four build lanes pin SOURCE_DATE_EPOCH (unsigned, linux, macos, windows)');

    assert.ok(/pnpm-lock\.yaml sha256/.test(wf),
        'the resolved dep tree is identified in the run record (§8)');

    // The barrier: the record job cannot run until every lane is green.
    assert.ok(/needs: \[verify-tag, build-unsigned, desktop-linux, desktop-macos, desktop-windows\]/
        .test(wf),
    'the release record waits on every lane (no partial release)');
}

// The config read the CI assertion depends on. If the publish block ever
// stops being greppable this fails here, not silently in a release lane.
{
    const cfg = readPublishConfig(join(root, 'packages/desktop/electron-builder.config.cjs'));
    assert.equal(cfg.channel, 'stable', 'readPublishConfig recovers the channel');
    assert.equal(cfg.url, 'https://downloads.xchain.io/wallet/desktop/',
        'readPublishConfig recovers the feed URL');
}

assert.ok(existsSync(join(root, 'tools/release/update-info.mjs')),
    'tools/release/update-info.mjs exists');

console.log('update-info smoke: ok');
