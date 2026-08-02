// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// REPRODUCIBLE_BUILDS.md promises that an independent verifier can rebuild
// a tag and get the maintainer's pre-signing bytes, and it says why that
// works: "the toolchain version is part of the output". The promise is
// therefore only as good as the weakest pin behind it, and the pins live
// in four separate files that nothing was holding together. ( §51.)
//
// What was actually there, all four found by reading the path end to end
// rather than by any failing test:
//
//   1. The release lanes asked actions/setup-node for major "22", which
//      resolves at RUN TIME. The reproduce container pinned an exact
//      20.18.0 - a different major, and below the repo's own engines
//      floor of >=22, so the container could not have installed the
//      workspace at all.
//   2. reproduce.sh derived SOURCE_DATE_EPOCH from %ct (committer date)
//      while the release lane used %at (author date). Equal only for
//      commits never rebased or amended; 10 of the last 200 here diverge,
//      by up to 36 minutes.
//   3. build.sh passed no arch flags, so it built the host arch only -
//      reproducing linux-x64 while we ship x64 AND arm64.
//   4. reproduce.sh mounted the source read-only, so the first `pnpm
//      install` died on EROFS. Nothing downstream of it had ever run.
//
// Every one of those produces a hash MISMATCH, and the published protocol
// tells the verifier to read a mismatch as possible supply-chain
// tampering. So the failure mode of a drifting pin is not "reproduction
// is unavailable", it is "reproduction accuses us". That is what this
// file exists to prevent recurring.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const toolchain = JSON.parse(read('tools/release/toolchain.json'));
const dockerfile = read('packages/desktop/Dockerfile');
const workflow = read('.github/workflows/release.yml');
const reproduceSh = read('packages/desktop/scripts/reproduce.sh');
const buildSh = read('packages/desktop/scripts/build.sh');
const pkg = JSON.parse(read('package.json'));

// ------------------------------------------------- the pin is a real pin

{
    assert.match(toolchain.node.version, /^\d+\.\d+\.\d+$/,
        `toolchain.json pins node "${toolchain.node.version}"; it must be an exact `
        + 'patch version. A major or minor alone resolves differently on different '
        + 'days, which is the whole defect this file guards.');

    assert.ok(toolchain.node.version.startsWith('22.'),
        `toolchain.json pins node ${toolchain.node.version}, but the repo's engines `
        + `field requires ${pkg.engines.node} and the suites silently skip off 22. `
        + 'Moving off 22 is a repo-wide decision, not a release-tooling one.');

    assert.match(toolchain.node.sha256.x64, /^[0-9a-f]{64}$/,
        'toolchain.json must carry the linux-x64 tarball sha256 as 64 lowercase hex '
        + 'digits; the Dockerfile checks the download against it.');
}

// ------------------------------------ home 1: the reproduce container

{
    const version = /^ARG NODE_VERSION=(.+)$/m.exec(dockerfile);
    assert.ok(version, 'Dockerfile must declare ARG NODE_VERSION');
    assert.equal(version[1].trim(), toolchain.node.version,
        `Dockerfile pins node ${version[1].trim()} but toolchain.json pins `
        + `${toolchain.node.version}. The ARG default is what a third party gets from `
        + 'a bare `docker build`, so a stale default here reproduces bytes nobody shipped.');

    const sha = /^ARG NODE_SHA256_X64=(.+)$/m.exec(dockerfile);
    assert.ok(sha, 'Dockerfile must declare ARG NODE_SHA256_X64');
    assert.equal(sha[1].trim(), toolchain.node.sha256.x64,
        'Dockerfile\'s node tarball sha256 disagrees with toolchain.json. Bumping the '
        + 'version without the hash makes the image build fail at `sha256sum -c`, which '
        + 'is the good failure - but bumping the hash without the version would install '
        + 'a Node nobody chose.');

    // The version and the hash have to move together or the pair is
    // meaningless, so nothing may reintroduce a second, unchecked copy.
    assert.ok(!/^ENV NODE_SHA256=/m.test(dockerfile),
        'Dockerfile still carries the old unparameterised ENV NODE_SHA256. Two hash '
        + 'declarations means one of them is not the one being used.');

    const pnpmArg = /^ARG PNPM_VERSION=(.+)$/m.exec(dockerfile);
    assert.ok(pnpmArg, 'Dockerfile must declare ARG PNPM_VERSION');
    const pnpmPinned = /^pnpm@(.+)$/.exec(pkg.packageManager || '');
    assert.ok(pnpmPinned, 'root package.json must pin packageManager to pnpm@<version>');
    assert.equal(pnpmArg[1].trim(), pnpmPinned[1],
        `Dockerfile defaults to pnpm ${pnpmArg[1].trim()} but packageManager pins `
        + `${pnpmPinned[1]}. reproduce.sh overrides this via --build-arg, so the drift is `
        + 'invisible there and only bites the verifier who runs `docker build` by hand.');

    assert.ok(dockerfile.includes(toolchain.baseImage.digest),
        'Dockerfile\'s FROM digest disagrees with toolchain.json\'s baseImage.digest.');
}

// -------------------------------------------- home 2: the release lanes

{
    const nodeVersions = [...workflow.matchAll(/^\s*node-version:\s*(\S+)\s*$/gm)]
        .map((m) => m[1].replace(/^['"]|['"]$/g, ''));

    assert.ok(nodeVersions.length > 0,
        'release.yml declares no node-version at all; setup-node would pick the '
        + 'runner default, which is a floating pin by another name.');

    for (const v of nodeVersions) {
        assert.match(v, /^\d+\.\d+\.\d+$/,
            `release.yml asks setup-node for "${v}". A bare major resolves to whatever `
            + 'patch is newest the day the lane runs, so the lane that signs the release '
            + 'and the container that verifies it drift apart on their own. Pin the exact '
            + `version from tools/release/toolchain.json (${toolchain.node.version}).`);
        assert.equal(v, toolchain.node.version,
            `release.yml lane pins node ${v} but toolchain.json pins `
            + `${toolchain.node.version}. Every lane builds bytes that get signed; they `
            + 'must all be the toolchain the reproduction uses.');
    }
}

// ------------------------------- home 3+4: the two SOURCE_DATE_EPOCH sites

{
    const fmt = toolchain.sourceDateEpoch.gitFormat;
    assert.equal(fmt, '%at',
        'toolchain.json must pin the author date (%at). Committer date changes on '
        + 'rebase and amend, which release prep does routinely.');

    const inRepro = /SOURCE_DATE_EPOCH="\$\(git log -1 --pretty=(%\w+)/.exec(reproduceSh);
    assert.ok(inRepro, 'reproduce.sh must derive SOURCE_DATE_EPOCH from git log');
    assert.equal(inRepro[1], fmt,
        `reproduce.sh stamps builds from ${inRepro[1]} but the pinned format is ${fmt}. `
        + 'The verifier and the release lane must stamp the SAME instant into the asar, '
        + 'or every rebased tag reproduces to a diff that reads as tampering.');

    const inWorkflow = [...workflow.matchAll(/git log -1 --pretty=(%\w+)/g)].map((m) => m[1]);
    assert.ok(inWorkflow.length > 0, 'release.yml must derive SOURCE_DATE_EPOCH from git log');
    for (const f of inWorkflow) {
        assert.equal(f, fmt,
            `release.yml stamps builds from ${f} but the pinned format is ${fmt}.`);
    }
}

// --------------------------------------- the arch set both sides build

{
    assert.deepEqual([...toolchain.linuxArches].sort(), ['arm64', 'x64'],
        'toolchain.json must declare both shipped linux arches (spec §2). Dropping one '
        + 'here silently stops reproducing an arch real users install.');

    // The lane and the container have to cover the same set, or the arch
    // they disagree on ships with no pre-signing hash anyone can check.
    const laneArches = [...workflow.matchAll(/dist --linux ([^\n]*)/g)]
        .map((m) => m[1].trim().split(/\s+/).filter((f) => f.startsWith('--')).sort().join(' '));
    assert.ok(laneArches.length > 0, 'release.yml must build the linux desktop lane');
    const expected = toolchain.linuxArches.map((a) => `--${a}`).sort().join(' ');
    for (const got of laneArches) {
        assert.equal(got, expected,
            `a release.yml linux build passes "${got}" but toolchain.json declares `
            + `"${expected}". The reproduction covers toolchain.json's set, so any arch `
            + 'the lane ships beyond it is unverifiable and any arch short of it is a '
            + 'manifest entry for a binary that was never released.');
    }

    // build.sh must take its arches from the same file rather than
    // hardcoding them - a literal here is the third copy that goes stale.
    assert.ok(/linuxArches/.test(buildSh),
        'build.sh must read its arch flags from tools/release/toolchain.json, not hardcode '
        + 'them. It previously passed no flags at all and quietly built the host arch only.');
    // `dist`, not `dist:unpacked`, since DD7: the reproduce path builds the
    // PACKAGED Linux artifacts so its manifest carries the filenames the
    // release publishes. The arch-flag requirement is unchanged and is
    // still the reason this assertion exists.
    assert.ok(/run dist --linux/.test(buildSh),
        'build.sh must pass --linux plus explicit arch flags to the packaging target; with '
        + 'no flags electron-builder defaults to the host arch and the manifest covers one arch.');
    assert.ok(!/run dist:unpacked/.test(buildSh),
        'build.sh must not go back to --dir mode: an unpacked manifest shares no filename '
        + 'with the published release manifest, so the documented comparison cannot succeed '
        + '( DD7).');
}

// ------------------------- the `--` that ate every architecture flag

// pnpm 9 forwards a literal `--` into the script's argv; npm strips it.
// electron-builder is yargs-based, so a bare `--` ends option parsing and
// everything after it lands in `argv._`, unread. Every desktop build in
// release.yml was written `pnpm -C packages/desktop dist -- --linux --x64
// --arm64`, so electron-builder saw no arch flags at all and packaged the
// runner's own arch: linux-x64 from the ubuntu lane, one arch per OS
// across the matrix. Nothing failed. expected-artifacts.txt matches by
// extension (`*.AppImage`, `*.exe`, `*.dmg`) rather than per arch, so the
// signing gate would have passed a release missing half its architectures,
// and `stable-linux-arm64.yml` would simply never have existed - leaving
// every arm64 install with no download and no update, permanently.
//
// Proven, not inferred: `pnpm@9.0.0 run x -- --a` yields argv
// ["--dir","--","--a"] while npm yields ["--dir","--a"], and the first
// real container run packaged x64 only from `--linux --x64 --arm64`.
{
    const offenders = [
        ...[...workflow.matchAll(/^\s*run:\s*(pnpm .*)$/gm)].map((m) => ['release.yml', m[1]]),
        ...[...buildSh.matchAll(/^(pnpm .*)$/gm)].map((m) => ['build.sh', m[1]]),
    ].filter(([, cmd]) => / -- (?=-)/.test(cmd));

    assert.deepEqual(offenders, [],
        'a pnpm invocation passes flags after a `--` separator:\n'
        + offenders.map(([f, c]) => `  ${f}: ${c}`).join('\n')
        + '\npnpm 9 forwards that `--` verbatim, and electron-builder then ignores '
        + 'every flag behind it. Drop the separator: `pnpm -C packages/desktop dist '
        + '--linux --x64 --arm64`.');
}

// ------------------------------------- the mount that made it all moot

{
    assert.ok(!/:\/workspace:ro/.test(reproduceSh),
        'reproduce.sh mounts /workspace read-only. `pnpm install` writes node_modules and '
        + 'electron-builder writes dist/, both inside it, so the run dies on EROFS at the '
        + 'first step and the published verification protocol cannot be executed by anyone. '
        + 'Isolation from the local checkout comes from the detached worktree, not the flag.');

    assert.ok(/--platform "\$\{BUILD_PLATFORM\}"/.test(reproduceSh),
        'reproduce.sh must pass --platform explicitly: the pinned base digest is amd64-only, '
        + 'and an arm64 verifier should emulate on purpose rather than discover it.');

    assert.ok(/XCHAIN_EXPECTED_NODE/.test(reproduceSh) && /XCHAIN_EXPECTED_NODE/.test(buildSh),
        'the container must assert its own Node against the ref\'s pin at run time. A cached '
        + 'image from an older Dockerfile is the one drift no file comparison can catch, and '
        + 'its only other symptom is a hash diff that reads as tampering.');
}

console.log('reproducible-toolchain smoke: ok');
