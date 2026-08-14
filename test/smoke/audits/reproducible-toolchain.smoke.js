// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The reproducible-builds doc (https://docs.xchain.io/components/wallet/reproducible-builds)
// promises that an independent verifier can rebuild
// a tag and get the maintainer's pre-signing bytes, and it says why that
// works: "the toolchain version is part of the output". The promise is
// therefore only as good as the weakest pin behind it, and the pins live
// in four separate files that nothing was holding together. (§51.)
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
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const toolchain = JSON.parse(read('tools/release/toolchain.json'));

// THREE shells build reproduce containers, not one, and only this one was
// ever checked. The 2026-08-06 pnpm 9 -> 11 raise moved the desktop
// Dockerfile's ARG and left the extension's and the web shell's at 9.0.0,
// which this file would have reported as clean. Each of their reproduce.sh
// scripts passes --build-arg from `packageManager`, so the stale default is
// invisible to anyone running the sanctioned path and bites only the
// third-party verifier who runs `docker build` by hand - which is the one
// reader the whole reproducible-build protocol is written for.
const DOCKERFILES = [
    'packages/desktop/Dockerfile',
    'packages/extension/Dockerfile',
    'packages/web/Dockerfile',
];
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

    const pnpmPinned = /^pnpm@(.+)$/.exec(pkg.packageManager || '');
    assert.ok(pnpmPinned, 'root package.json must pin packageManager to pnpm@<version>');

    // Every shell's container, not just this one. They share one
    // toolchain.json, so a per-shell default that disagrees with it is drift
    // by definition rather than a shell making its own choice.
    for (const path of DOCKERFILES) {
        const text = read(path);

        const pnpmArg = /^ARG PNPM_VERSION=(.+)$/m.exec(text);
        assert.ok(pnpmArg, `${path} must declare ARG PNPM_VERSION`);
        assert.equal(pnpmArg[1].trim(), pnpmPinned[1],
            `${path} defaults to pnpm ${pnpmArg[1].trim()} but packageManager pins `
            + `${pnpmPinned[1]}. reproduce.sh overrides this via --build-arg, so the drift is `
            + 'invisible there and only bites the verifier who runs `docker build` by hand.');

        const shellNode = /^ARG NODE_VERSION=(.+)$/m.exec(text);
        assert.ok(shellNode, `${path} must declare ARG NODE_VERSION`);
        assert.equal(shellNode[1].trim(), toolchain.node.version,
            `${path} pins node ${shellNode[1].trim()} but toolchain.json pins `
            + `${toolchain.node.version}.`);

        const shellSha = /^ARG NODE_SHA256_X64=(.+)$/m.exec(text);
        assert.ok(shellSha, `${path} must declare ARG NODE_SHA256_X64`);
        assert.equal(shellSha[1].trim(), toolchain.node.sha256.x64,
            `${path}'s node tarball sha256 disagrees with toolchain.json.`);

        assert.ok(text.includes(toolchain.baseImage.digest),
            `${path}'s FROM digest disagrees with toolchain.json's baseImage.digest.`);
    }

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
        + '(DD7).');
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

    // Counted, not merely present. Both `docker build` and `docker run`
    // need it: pinning the build and letting the run take the host arch
    // gives "image platform does not match" at best and a quietly
    // different container at worst. A presence test passes with one of
    // the two, which is exactly the half-fix this file exists to catch -
    // and it is how the extension and web lanes stayed broken while the
    // desktop twin looked like the reference implementation.
    assert.equal((reproduceSh.match(/--platform "\$\{BUILD_PLATFORM\}"/g) || []).length, 2,
        'reproduce.sh must pass --platform explicitly on BOTH docker invocations: '
        + 'the pinned base digest is amd64-only, '
        + 'and an arm64 verifier should emulate on purpose rather than discover it.');

    assert.ok(/XCHAIN_EXPECTED_NODE/.test(reproduceSh) && /XCHAIN_EXPECTED_NODE/.test(buildSh),
        'the container must assert its own Node against the ref\'s pin at run time. A cached '
        + 'image from an older Dockerfile is the one drift no file comparison can catch, and '
        + 'its only other symptom is a hash diff that reads as tampering.');
}

// ------------------------------------ home 4: the EXTENSION reproduce pair
//
// This block exists because everything above it was true and the release
// still could not be reproduced. §6 step 3 reproduces three things -
// Linux desktop, extension, web tarball - and only the desktop pair was
// ever held to toolchain.json. The extension's Dockerfile carried a
// hardcoded `ENV NODE_VERSION=20.18.0` against a release lane building
// the same bundle with 22.23.2, and its reproduce.sh passed no
// --platform against an amd64-only base digest. So on amd64 the
// reproduction built the wrong bytes, and on arm64 it did not build at
// all (`exit code: 133`, an exec-format error inside a RUN layer, naming
// nothing). Both were measured 2026-08-02, not reasoned about.
//
// The lesson generalises past this file: a guard that names its
// consumers by hand is only as good as that list, and the list omitted a
// consumer that existed when it was written.

// Both non-desktop lanes, not just the extension. Checking one of them
// would repeat the mistake being fixed: the web lane carried the SAME
// four defects, byte for byte, down to the identical stale Node sha256
// and the identical nested-backtick bug, and was found only because this
// block was generalised rather than written for the lane that happened
// to be under investigation.
for (const pkg of ['extension', 'web']) {
    const extDockerfile = read(`packages/${pkg}/Dockerfile`);
    const extReproduceSh = read(`packages/${pkg}/scripts/reproduce.sh`);

    const version = /^ARG NODE_VERSION=(.+)$/m.exec(extDockerfile);
    assert.ok(version, `packages/${pkg}/Dockerfile must declare ARG NODE_VERSION, not a `
        + 'hardcoded ENV. The release lane builds this bundle from toolchain.json, so a '
        + 'private pin here reproduces bytes the release never produced.');
    assert.equal(version[1].trim(), toolchain.node.version,
        `${pkg} Dockerfile pins node ${version[1].trim()} but toolchain.json pins `
        + `${toolchain.node.version}.`);

    const sha = /^ARG NODE_SHA256_X64=(.+)$/m.exec(extDockerfile);
    assert.ok(sha, `packages/${pkg}/Dockerfile must declare ARG NODE_SHA256_X64`);
    assert.equal(sha[1].trim(), toolchain.node.sha256.x64,
        'extension Dockerfile\'s node tarball sha256 disagrees with toolchain.json.');

    assert.ok(!/^ENV NODE_SHA256=/m.test(extDockerfile),
        '${pkg} Dockerfile still carries the old unparameterised ENV NODE_SHA256.');

    // Comment-blind on purpose: the header explains the old hardcoded pin
    // by quoting it, and a naive substring search reads its own
    // documentation as the defect.
    const extDirectives = extDockerfile
        .split('\n')
        .filter((l) => !/^\s*#/.test(l));
    const literalNodePins = extDirectives
        .filter((l) => /^\s*(ENV|ARG)\s+NODE_VERSION=/.test(l))
        .filter((l) => !/^\s*ENV\s+NODE_VERSION=\$\{NODE_VERSION\}\s*$/.test(l));
    assert.equal(literalNodePins.length, 1,
        '${pkg} Dockerfile must declare exactly one literal NODE_VERSION pin (the ARG), '
        + `found ${literalNodePins.length}: ${JSON.stringify(literalNodePins)}. Two `
        + 'declarations means one of them is not the one being used.');

    assert.ok(extDockerfile.includes(toolchain.baseImage.digest),
        'extension Dockerfile\'s FROM digest disagrees with toolchain.json\'s baseImage.digest.');

    // The arm64 half. Both docker invocations need it: pinning the build
    // and letting the run pick the host arch produces "image platform does
    // not match" at best and a silently different container at worst.
    const platformFlags = extReproduceSh.match(/--platform "\$\{BUILD_PLATFORM\}"/g) || [];
    assert.equal(platformFlags.length, 2,
        `packages/${pkg}/scripts/reproduce.sh must pass --platform on BOTH \`docker build\` `
        + `and \`docker run\` (found ${platformFlags.length}). The pinned base digest is `
        + 'amd64-only, so without it an arm64 verifier builds an arm64 image, the x64 Node '
        + 'tarball cannot exec, and the build dies at `exit code: 133` naming no cause.');

    assert.ok(/tools\/release\/toolchain\.json/.test(extReproduceSh),
        '${pkg} reproduce.sh must read the pins from tools/release/toolchain.json so an '
        + 'older tag reproduces with the Node IT pinned, not with today\'s.');

    for (const arg of ['NODE_VERSION', 'NODE_SHA256_X64']) {
        assert.ok(new RegExp(`--build-arg "${arg}=`).test(extReproduceSh),
            `${pkg} reproduce.sh must feed --build-arg ${arg} from toolchain.json; `
            + 'otherwise the Dockerfile default is what builds, and a default is not a pin.');
    }
}

// --------------- home 5: the RELEASE LANE builds where the verifier does
//
// Everything above pinned Node for both sides, and the reproduction still
// could not match a compiled file. Nothing pinned the C compiler.
// `desktop-linux` was `runs-on: ubuntu-latest` with no container while the
// reproduction builds in debian:bookworm-slim at a fixed digest, so
// node-gyp compiled tiny-secp256k1 against a different gcc and glibc on
// each side. Measured on the real v0.334.0 deb: 186 of 188 files
// reproduced, and the two that did not were `secp256k1.node` and the asar
// whose header embeds its hash.
//
// That is the same failure mode this whole file exists for, one layer down:
// the protocol tells a verifier to read a mismatch as tampering, so an
// unpinned toolchain does not make reproduction unavailable, it makes
// reproduction accuse us. The generalisation the extension block already
// learned applies again here - a pin is only worth the number of sides it
// binds, and toolchain.json bound the lane's Node while the lane itself ran
// outside the container entirely.
//
// The lane now calls reproduce.sh, so there is one container invocation
// rather than two that can drift. These assertions are about the three ways
// that can be undone while every other check in this file stays green.

/**
 * The block of `release.yml` belonging to one job, by indentation, with
 * comment lines dropped.
 *
 * Comment-blind on purpose, the same way the extension block above is: the
 * steps below explain the defect by naming it ("no host `pnpm install`"),
 * and a naive substring search reads that documentation as the defect.
 */
function jobBlock(name) {
    const lines = workflow.split('\n');
    const start = lines.indexOf(`  ${name}:`);
    assert.notEqual(start, -1, `release.yml defines a ${name} job`);
    const out = [];
    for (const line of lines.slice(start + 1)) {
        if (/^ {2}\S/.test(line)) break;
        if (/^\s*#/.test(line)) continue;
        out.push(line);
    }
    return out.join('\n');
}

{
    const linuxJob = jobBlock('desktop-linux');

    // 1. The lane builds through the verifier's script, in the verifier's
    //    image. Both halves are asserted: the call alone would pass if the
    //    in-place switch were dropped, and reproduce.sh without it builds a
    //    throwaway worktree it deletes, leaving the lane with no artifacts.
    assert.match(linuxJob, /bash packages\/desktop\/scripts\/reproduce\.sh\b/,
        'the desktop-linux job must cut its Linux artifacts through '
        + 'packages/desktop/scripts/reproduce.sh, which builds inside the digest-pinned '
        + 'image. A build on the bare runner compiles tiny-secp256k1 against the runner\'s '
        + 'gcc and glibc, and secp256k1.node plus the asar carrying its hash then reproduce '
        + 'to a diff the published protocol tells the verifier to read as tampering.');
    assert.match(linuxJob, /XCHAIN_REPRODUCE_IN_PLACE:\s*'1'/,
        'and it must pass XCHAIN_REPRODUCE_IN_PLACE=1. Without it reproduce.sh builds a '
        + 'detached worktree and deletes it on exit, so the lane would upload nothing.');

    assert.match(reproduceSh, /XCHAIN_REPRODUCE_IN_PLACE/,
        'packages/desktop/scripts/reproduce.sh must implement the in-place mode the release '
        + 'lane runs it in; the lane and the verifier share this file precisely so there is '
        + 'no second copy of the container invocation to go stale.');

    // 2. In-place drops the worktree, so it must re-earn what the worktree
    //    guaranteed. A mode that will happily build a dirty tree is not a
    //    reproduction of any commit, and it would be the release lane using
    //    it.
    for (const [guard, re] of [
        ['refuse a ref that is not the checked-out HEAD',
            /\$\{COMMIT_SHA\}"\s*!=\s*"\$\{HEAD_SHA\}"/],
        ['refuse a checkout with uncommitted changes', /git status --porcelain/],
    ]) {
        assert.match(reproduceSh, re,
            `reproduce.sh's in-place mode must ${guard}. It builds the checkout instead of a `
            + 'detached worktree, so the two properties the worktree provided for free are '
            + 'now assertions this file has to make itself.');
    }

    // 3. THE COMPILE IS AT INSTALL TIME. `npmRebuild: false` and
    //    `buildDependenciesFromSource: false` mean electron-builder never
    //    calls node-gyp - `pnpm install` does. So a host install anywhere in
    //    this job hands the container host-compiled addons to package, and
    //    the whole fix is undone with every other gate still green. This is
    //    the most plausible way it gets reverted: adding one innocuous
    //    install step back.
    assert.doesNotMatch(linuxJob, /pnpm install/,
        'the desktop-linux job runs `pnpm install` on the runner. The native addon is '
        + 'compiled by node-gyp during INSTALL, not during packaging, so a host install '
        + 'leaves host-compiled bytes for the container to package and the reproduction '
        + 'fails on exactly the files it failed on before. The only install in this job is '
        + 'the one build.sh runs inside the image.');

    // 4. And nothing may repackage the reproduced artifacts on the host
    //    afterwards. The Snap lane is the live example: snapcraft cannot run
    //    in the image, so it runs here, and a full `--linux` build would
    //    rewrite the AppImage and the deb in place with host bytes.
    //    Narrowing it to the snap target is what keeps that from happening
    //    the day the Snap credential lands.
    //    THE REHEARSAL VARIANT USED TO BE EXEMPT HERE AND IS NOT ANY MORE
    //    (row 136). The exemption reasoned about reproducibility -
    //    nothing publishes a pre-signing hash for a rehearsal, so it has no
    //    reproduction for a host toolchain to break - and that was true and
    //    beside the point. A later fix measured what a host build omits: the
    //    runner install never compiles tiny-secp256k1 into the packaged tree,
    //    so a host-built rehearsal ships the JS elliptic-curve fallback where
    //    a release ships the addon, and xr_check_payload_native refuses that
    //    shape. A rehearsal that could not pass the release's own payload
    //    gate is not a rehearsal of the release. The snap stays exempt for
    //    the reason it always had: snapcraft cannot run in the image.
    const hostBuilds = linuxJob.split(/\n(?= {6}- )/)
        .filter((step) => /dist --linux/.test(step));
    for (const step of hostBuilds) {
        const name = (/name: (.+)/.exec(step) || [, step.trim().split('\n')[0]])[1];
        assert.ok(/dist --linux snap\b/.test(step),
            `the desktop-linux step "${name}" runs a full electron-builder Linux build on the `
            + 'runner. It would rewrite the AppImage and the deb that the container just '
            + 'produced, with bytes compiled against the runner\'s toolchain, and nothing '
            + 'downstream can tell. A host build in this job is allowed only for the snap '
            + '(snapcraft cannot run in the image, and the snap is outside the reproduce set). '
            + 'The rehearsal variant goes through reproduce.sh like everything else.');
    }

    // 5. The rehearsal goes through the container, in its OWN out dir.
    //
    //    Two separate failures, and the second is the quiet one. Routing the
    //    rehearsal back onto the host re-creates a bundle the payload gate
    //    refuses; pointing it at the production run's out dir overwrites
    //    RELEASE_HASHES.txt for the artifacts this release actually
    //    publishes, with the rehearsal's, and nothing downstream would say so.
    const reproSteps = linuxJob.split(/\n(?= {6}- )/)
        .filter((step) => /reproduce\.sh/.test(step));
    assert.equal(reproSteps.length, 2,
        `the desktop-linux job calls reproduce.sh ${reproSteps.length} time(s); it must call it `
        + 'exactly twice - once for the release set and once for the §7.5 rehearsal variant, '
        + 'so both are cut by the same code path a third party runs.');

    const rehearsal = reproSteps.filter((s) => /XCHAIN_STAGING_FEED_URL/.test(s));
    assert.equal(rehearsal.length, 1,
        'exactly one of the desktop-linux reproduce.sh steps must carry '
        + 'XCHAIN_STAGING_FEED_URL. That variable is what selects the rehearsal variant at '
        + 'build time; without it the step reproduces a second production set.');
    assert.match(rehearsal[0], /XCHAIN_REPRODUCE_IN_PLACE: '1'/,
        'the rehearsal reproduce.sh step does not set XCHAIN_REPRODUCE_IN_PLACE, so it builds '
        + 'a detached worktree whose dist-staging is deleted on exit and the upload finds '
        + 'nothing.');

    const outDirs = reproSteps.map((s) => (/reproduce\.sh HEAD "([^"]+)"/.exec(s) || [, null])[1]);
    assert.ok(outDirs.every(Boolean),
        `a reproduce.sh step in desktop-linux passes no quoted out dir: ${JSON.stringify(outDirs)}`);
    assert.notEqual(outDirs[0], outDirs[1],
        `both desktop-linux reproduce.sh steps write to ${outDirs[0]}. reproduce.sh emits `
        + "RELEASE_HASHES.txt into that directory, so the rehearsal would overwrite the "
        + 'release set\'s own manifest and the published hashes would describe bytes nobody '
        + 'shipped.');
}

// ------- home 6: the §7.5 rehearsal selector has to reach the container
//
// The lane above made the container the only place a shippable Linux bundle
// is cut, and that closed the rehearsal off. A §7.5 rehearsal variant is
// selected purely by XCHAIN_STAGING_FEED_URL, which
// electron-builder.config.cjs reads at build time; `docker run` passed a
// FIXED `-e` list that did not carry it, so the container could only ever
// produce a production set. Meanwhile a rehearsal built OUTSIDE the
// container carries no compiled tiny-secp256k1, and xr_check_payload_native
// in tools/release/lib.sh now refuses exactly that. So the only
// rehearsal a maintainer could build was correctly refused, and the only
// build path that satisfies the gate could not bake the staging feed: §7.5
// was unreachable, with every check in this file green.
//
// TWO WAYS THIS BREAKS, AND ONLY ONE OF THEM LOOKS LIKE A REGRESSION.
// Dropping the passthrough re-closes §7.5, loudly. The other one is worse
// and would be done as tidying: making the `-e` unconditional. An env var
// that is always declared, empty or not, is a change to the build
// environment of every PRODUCTION reproduction, which is the one property
// this whole file defends. Both are driven below rather than pattern
// matched, because the difference between them lives in shell expansion and
// not in the text.
{
    // Taken from the file, not restated, so the harness drives reproduce.sh's
    // own derivation. The `:-` form is what keeps `set -u` off the unset case.
    const derive = /^STAGING_FEED_URL="\$\{XCHAIN_STAGING_FEED_URL:-\}"$/m.exec(reproduceSh);
    assert.ok(derive,
        'reproduce.sh must read XCHAIN_STAGING_FEED_URL into STAGING_FEED_URL via the '
        + 'unset-safe `${XCHAIN_STAGING_FEED_URL:-}` form. The script runs under `set -u`, '
        + 'so a bare reference aborts every production reproduction, which is a worse '
        + 'failure than the one being fixed.');

    // The `docker run` invocation, verbatim, from the file under test.
    const runStart = reproduceSh.indexOf('docker run --rm');
    assert.notEqual(runStart, -1, 'reproduce.sh must invoke `docker run --rm`');
    const tail = '"${IMAGE_TAG}"';
    const runEnd = reproduceSh.indexOf(tail, runStart);
    assert.notEqual(runEnd, -1, 'reproduce.sh\'s `docker run` must end with the image tag');
    const dockerRun = reproduceSh.slice(runStart, runEnd + tail.length);

    /**
     * The argv `docker run` would receive, with `docker` stubbed and every
     * variable the invocation reads supplied. Nothing is built and no
     * container starts; this is the shell doing its expansion and printing
     * the result. `null` means the variable is absent from the environment
     * entirely, which is the production case.
     */
    function dockerRunArgv(staging) {
        const script = [
            'set -euo pipefail',
            'docker() { printf "%s\\n" "$@"; }',
            'BUILD_PLATFORM=linux/amd64',
            'SOURCE_DATE_EPOCH=1700000000',
            `NODE_VERSION=${toolchain.node.version}`,
            `COMMIT_SHA=${'0'.repeat(40)}`,
            'SDK_COMMIT=',
            'SDK_PINNED=npm:@dankest-llc/xchain-sdk@0.0.0',
            'SDK_WORKTREE_DIR=',
            'WORKTREE_DIR=/guard/worktree',
            'OUT_DIR_ABS=/guard/out',
            'IMAGE_TAG=xchain-wallet-desktop:guard',
            derive[0],
            dockerRun,
        ].join('\n');

        const env = { ...process.env };
        if (staging === null) delete env.XCHAIN_STAGING_FEED_URL;
        else env.XCHAIN_STAGING_FEED_URL = staging;

        const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env });
        assert.equal(r.status, 0,
            `reproduce.sh's docker invocation does not evaluate cleanly: ${r.stderr}`);
        return r.stdout.split('\n').filter((l) => l !== '');
    }

    const STAGING = 'https://downloads.xchain.io/wallet/_rehearsal-7f3a91c2/desktop/';
    const bare = dockerRunArgv(null);
    const empty = dockerRunArgv('');
    const set = dockerRunArgv(STAGING);

    // 1. THE PRODUCTION RUN IS UNCHANGED. Absent and empty must both give
    //    the argv the script had before the passthrough existed - not an
    //    `-e` with an empty value, not a declared-but-blank variable.
    assert.deepEqual(empty, bare,
        'reproduce.sh builds a different `docker run` for XCHAIN_STAGING_FEED_URL="" than '
        + 'for the variable being absent. An empty rehearsal selector IS a production '
        + 'build, and the release lane sets the variable from a secret that may be unset.');
    for (const argv of [bare, empty]) {
        assert.equal(argv.filter((a) => a.includes('XCHAIN_STAGING_FEED_URL')).length, 0,
            'a production reproduction passes XCHAIN_STAGING_FEED_URL into the container. '
            + 'Even empty, that declares a variable in the build environment that was not '
            + 'there before, and Level-2 reproducibility is a claim about that environment. '
            + 'Keep the `${STAGING_FEED_URL:+-e ...}` conditional; do not flatten it.');
    }

    // 2. AND THE REHEARSAL RUN CARRIES IT. Positional, so a passthrough that
    //    loses its `-e` (one word, silently making the value a stray arg) is
    //    caught too.
    const idx = set.findIndex((a) => a === `XCHAIN_STAGING_FEED_URL=${STAGING}`);
    assert.notEqual(idx, -1,
        'reproduce.sh does not forward XCHAIN_STAGING_FEED_URL to the container. '
        + 'electron-builder.config.cjs selects the §7.5 rehearsal variant off that variable '
        + 'at build time, so without it the container can only produce a production set - '
        + 'and a rehearsal built outside the container has no compiled tiny-secp256k1, which '
        + 'xr_check_payload_native in tools/release/lib.sh refuses. Between the '
        + 'two, §7.5 has no build path at all.');
    assert.equal(set[idx - 1], '-e',
        'the forwarded XCHAIN_STAGING_FEED_URL is not preceded by `-e`, so docker reads it '
        + 'as a positional argument rather than an environment variable.');

    // 3. The delta is EXACTLY those two words. Anything else the rehearsal
    //    path changes about the invocation is a second variable between the
    //    two builds, and nothing downstream would name it.
    const withoutStaging = [...set];
    withoutStaging.splice(idx - 1, 2);
    assert.deepEqual(withoutStaging, bare,
        'a rehearsal `docker run` differs from the production one by more than the single '
        + '`-e XCHAIN_STAGING_FEED_URL=...` pair. The two builds already differ in the bytes '
        + 'they produce; any further difference in HOW they are built makes a rehearsal stop '
        + 'exercising the release path it exists to rehearse.');

    // 4. One invocation, both modes. In-place changes WORKTREE_DIR and the
    //    cleanup and nothing else, so a second `docker run` added for the
    //    lane would be a second copy of the pin set - the defect home 5
    //    exists to prevent, and it would take the passthrough out of sync
    //    with it too.
    assert.equal((reproduceSh.match(/^docker run /gm) || []).length, 1,
        'reproduce.sh has more than one `docker run`. The in-place mode the release lane '
        + 'uses and the worktree mode a verifier uses must share ONE container invocation, '
        + 'or the lane and the verification drift apart exactly as they did before.');
}

// ------- home 7: the rehearsal has to be MANIFESTED from its own directory
//
// Home 6 got the staging selector into the container. What it could not see
// is that build.sh then hashed a hard-coded `dist/`, while
// electron-builder.config.cjs writes a staging build to `dist-staging`. In a
// fresh worktree that mismatch failed loudly under `set -e` and cost nothing.
// Under XCHAIN_REPRODUCE_IN_PLACE=1 - the mode the release lane itself uses -
// it SUCCEEDED, because dist/ is already on disk from the production
// container run earlier in the same job, so a rehearsal would have emitted a
// manifest of the PRODUCTION artifacts and the rehearsal set would have gone
// unhashed beside it. That is the §7.5 seam finding one level up: a rehearsal
// and its proof must ride the same bytes, and a rehearsal that reports on the
// wrong ones is worse than a rehearsal that cannot run.
//
// Driven, and pinned to the config, because there are two ways to break it
// and neither is a typo. The selection can invert or go stale (a rename in
// the config that nothing propagates here re-creates the exact defect), and
// the empty-string case can drift apart between the two files - the release
// lane feeds this variable from a secret that may be unset, and `-n ""` and
// JavaScript's `"" || null` have to keep agreeing that an empty selector is a
// PRODUCTION build.
{
    const selector = /\nif \[ -n "\$\{XCHAIN_STAGING_FEED_URL:-\}" \]; then\n(?:.*\n)*?fi\n/
        .exec(buildSh);
    assert.ok(selector,
        'build.sh must choose its manifest directory from `${XCHAIN_STAGING_FEED_URL:-}` in '
        + 'an if/fi block. The `:-` form is what keeps `set -u` off the production case, '
        + 'where the variable is absent entirely.');

    assert.ok(!/^cd \/workspace\/packages\/desktop\/dist$/m.test(buildSh),
        'build.sh still cds to a hard-coded packages/desktop/dist. Under '
        + 'XCHAIN_REPRODUCE_IN_PLACE=1 that path exists from the production build in the '
        + 'same job, so a rehearsal silently manifests the production artifacts instead of '
        + 'failing.');
    assert.ok(/^cd "\/workspace\/packages\/desktop\/\$\{DIST_DIR\}"$/m.test(buildSh),
        'build.sh does not cd into the directory its own selector chose, so the selector '
        + 'decides nothing.');

    /**
     * DIST_DIR and BUILD_VARIANT as build.sh's own block computes them, run
     * under the same `set -euo pipefail` the script uses. `null` means the
     * variable is absent from the environment, which is the production case.
     */
    function select(staging) {
        const script = ['set -euo pipefail', selector[0], 'printf "%s\\n%s\\n" "${DIST_DIR}" "${BUILD_VARIANT}"'].join('\n');
        const env = { ...process.env };
        if (staging === null) delete env.XCHAIN_STAGING_FEED_URL;
        else env.XCHAIN_STAGING_FEED_URL = staging;
        const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env });
        assert.equal(r.status, 0,
            `build.sh's output-directory selector does not evaluate cleanly: ${r.stderr}`);
        const [dir, variant] = r.stdout.split('\n');
        return { dir, variant };
    }

    // The config is the authority on both names; build.sh mirrors it, and this
    // is the assertion that fails when only one of the two is renamed.
    const config = read('packages/desktop/electron-builder.config.cjs');
    const outputs = /output:\s*isStaging \? '([^']+)' : '([^']+)'/.exec(config);
    assert.ok(outputs,
        "electron-builder.config.cjs no longer sets `directories.output` as "
        + "`isStaging ? '<staging>' : '<production>'`. build.sh mirrors that expression to "
        + 'find the artifacts it hashes; re-point this guard at whatever replaced it rather '
        + 'than deleting it.');
    const [, stagingDir, productionDir] = outputs;

    const STAGING = 'https://downloads.xchain.io/wallet/_rehearsal-7f3a91c2/desktop/';
    assert.deepEqual(select(STAGING), { dir: stagingDir, variant: 'staging' },
        `a rehearsal build does not manifest ${stagingDir}/, which is where `
        + 'electron-builder.config.cjs puts it. The manifest would cover whatever else is '
        + 'on disk.');
    for (const absent of [null, '']) {
        assert.deepEqual(select(absent), { dir: productionDir, variant: 'production' },
            'a production build does not manifest ' + productionDir + '/ when '
            + `XCHAIN_STAGING_FEED_URL is ${absent === null ? 'absent' : 'empty'}. The config `
            + 'reads that variable as `process.env.X || null`, so an empty selector is a '
            + 'production build there; the two files must not disagree about which build '
            + 'the release lane just made.');
    }

    // The variant reaches the reader, not just the shell. Both manifests carry
    // it, so a file on its own says which build it describes - the question a
    // maintainer holding two RELEASE_HASHES.txt files actually has.
    assert.equal((buildSh.match(/^ {4}echo "# variant: +\$\{BUILD_VARIANT\}"$/gm) || []).length, 2,
        'build.sh does not stamp `# variant:` into BOTH manifests. Without it the packaged '
        + 'and diagnostic manifests of a rehearsal are byte-shaped exactly like a release\'s '
        + 'and nothing in the file says otherwise.');
}

// ------- home 6: the §7.5 rehearsal selector has to reach the container
//
// The lane above made the container the only place a shippable Linux bundle
// is cut, and that closed the rehearsal off. A §7.5 rehearsal variant is
// selected purely by XCHAIN_STAGING_FEED_URL, which
// electron-builder.config.cjs reads at build time; `docker run` passed a
// FIXED `-e` list that did not carry it, so the container could only ever
// produce a production set. Meanwhile a rehearsal built OUTSIDE the
// container carries no compiled tiny-secp256k1, and xr_check_payload_native
// in tools/release/lib.sh now refuses exactly that  . So the only
// rehearsal a maintainer could build was correctly refused, and the only
// build path that satisfies the gate could not bake the staging feed: §7.5
// was unreachable, with every check in this file green.
//
// TWO WAYS THIS BREAKS, AND ONLY ONE OF THEM LOOKS LIKE A REGRESSION.
// Dropping the passthrough re-closes §7.5, loudly. The other one is worse
// and would be done as tidying: making the `-e` unconditional. An env var
// that is always declared, empty or not, is a change to the build
// environment of every PRODUCTION reproduction, which is the one property
// this whole file defends. Both are driven below rather than pattern
// matched, because the difference between them lives in shell expansion and
// not in the text.
{
    // Taken from the file, not restated, so the harness drives reproduce.sh's
    // own derivation. The `:-` form is what keeps `set -u` off the unset case.
    const derive = /^STAGING_FEED_URL="\$\{XCHAIN_STAGING_FEED_URL:-\}"$/m.exec(reproduceSh);
    assert.ok(derive,
        'reproduce.sh must read XCHAIN_STAGING_FEED_URL into STAGING_FEED_URL via the '
        + 'unset-safe `${XCHAIN_STAGING_FEED_URL:-}` form. The script runs under `set -u`, '
        + 'so a bare reference aborts every production reproduction, which is a worse '
        + 'failure than the one being fixed.');

    // The `docker run` invocation, verbatim, from the file under test.
    const runStart = reproduceSh.indexOf('docker run --rm');
    assert.notEqual(runStart, -1, 'reproduce.sh must invoke `docker run --rm`');
    const tail = '"${IMAGE_TAG}"';
    const runEnd = reproduceSh.indexOf(tail, runStart);
    assert.notEqual(runEnd, -1, 'reproduce.sh\'s `docker run` must end with the image tag');
    const dockerRun = reproduceSh.slice(runStart, runEnd + tail.length);

    /**
     * The argv `docker run` would receive, with `docker` stubbed and every
     * variable the invocation reads supplied. Nothing is built and no
     * container starts; this is the shell doing its expansion and printing
     * the result. `null` means the variable is absent from the environment
     * entirely, which is the production case.
     */
    function dockerRunArgv(staging) {
        const script = [
            'set -euo pipefail',
            'docker() { printf "%s\\n" "$@"; }',
            'BUILD_PLATFORM=linux/amd64',
            'SOURCE_DATE_EPOCH=1700000000',
            `NODE_VERSION=${toolchain.node.version}`,
            `COMMIT_SHA=${'0'.repeat(40)}`,
            'SDK_COMMIT=',
            'SDK_PINNED=npm:@dankest-llc/xchain-sdk@0.0.0',
            'SDK_WORKTREE_DIR=',
            'WORKTREE_DIR=/guard/worktree',
            'OUT_DIR_ABS=/guard/out',
            'IMAGE_TAG=xchain-wallet-desktop:guard',
            derive[0],
            dockerRun,
        ].join('\n');

        const env = { ...process.env };
        if (staging === null) delete env.XCHAIN_STAGING_FEED_URL;
        else env.XCHAIN_STAGING_FEED_URL = staging;

        const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env });
        assert.equal(r.status, 0,
            `reproduce.sh's docker invocation does not evaluate cleanly: ${r.stderr}`);
        return r.stdout.split('\n').filter((l) => l !== '');
    }

    const STAGING = 'https://downloads.xchain.io/wallet/_rehearsal-7f3a91c2/desktop/';
    const bare = dockerRunArgv(null);
    const empty = dockerRunArgv('');
    const set = dockerRunArgv(STAGING);

    // 1. THE PRODUCTION RUN IS UNCHANGED. Absent and empty must both give
    //    the argv the script had before the passthrough existed - not an
    //    `-e` with an empty value, not a declared-but-blank variable.
    assert.deepEqual(empty, bare,
        'reproduce.sh builds a different `docker run` for XCHAIN_STAGING_FEED_URL="" than '
        + 'for the variable being absent. An empty rehearsal selector IS a production '
        + 'build, and the release lane sets the variable from a secret that may be unset.');
    for (const argv of [bare, empty]) {
        assert.equal(argv.filter((a) => a.includes('XCHAIN_STAGING_FEED_URL')).length, 0,
            'a production reproduction passes XCHAIN_STAGING_FEED_URL into the container. '
            + 'Even empty, that declares a variable in the build environment that was not '
            + 'there before, and Level-2 reproducibility is a claim about that environment. '
            + 'Keep the `${STAGING_FEED_URL:+-e ...}` conditional; do not flatten it.');
    }

    // 2. AND THE REHEARSAL RUN CARRIES IT. Positional, so a passthrough that
    //    loses its `-e` (one word, silently making the value a stray arg) is
    //    caught too.
    const idx = set.findIndex((a) => a === `XCHAIN_STAGING_FEED_URL=${STAGING}`);
    assert.notEqual(idx, -1,
        'reproduce.sh does not forward XCHAIN_STAGING_FEED_URL to the container. '
        + 'electron-builder.config.cjs selects the §7.5 rehearsal variant off that variable '
        + 'at build time, so without it the container can only produce a production set - '
        + 'and a rehearsal built outside the container has no compiled tiny-secp256k1, which '
        + 'xr_check_payload_native in tools/release/lib.sh refuses (). Between the'
        + 'two, §7.5 has no build path at all.');
    assert.equal(set[idx - 1], '-e',
        'the forwarded XCHAIN_STAGING_FEED_URL is not preceded by `-e`, so docker reads it '
        + 'as a positional argument rather than an environment variable.');

    // 3. The delta is EXACTLY those two words. Anything else the rehearsal
    //    path changes about the invocation is a second variable between the
    //    two builds, and nothing downstream would name it.
    const withoutStaging = [...set];
    withoutStaging.splice(idx - 1, 2);
    assert.deepEqual(withoutStaging, bare,
        'a rehearsal `docker run` differs from the production one by more than the single '
        + '`-e XCHAIN_STAGING_FEED_URL=...` pair. The two builds already differ in the bytes '
        + 'they produce; any further difference in HOW they are built makes a rehearsal stop '
        + 'exercising the release path it exists to rehearse.');

    // 4. One invocation, both modes. In-place changes WORKTREE_DIR and the
    //    cleanup and nothing else, so a second `docker run` added for the
    //    lane would be a second copy of the pin set - the defect home 5
    //    exists to prevent, and it would take the passthrough out of sync
    //    with it too.
    assert.equal((reproduceSh.match(/^docker run /gm) || []).length, 1,
        'reproduce.sh has more than one `docker run`. The in-place mode the release lane '
        + 'uses and the worktree mode a verifier uses must share ONE container invocation, '
        + 'or the lane and the verification drift apart exactly as they did before.');
}

// ------- home 7: the rehearsal has to be MANIFESTED from its own directory
//
// Home 6 got the staging selector into the container. What it could not see
// is that build.sh then hashed a hard-coded `dist/`, while
// electron-builder.config.cjs writes a staging build to `dist-staging`. In a
// fresh worktree that mismatch failed loudly under `set -e` and cost nothing.
// Under XCHAIN_REPRODUCE_IN_PLACE=1 - the mode the release lane itself uses -
// it SUCCEEDED, because dist/ is already on disk from the production
// container run earlier in the same job, so a rehearsal would have emitted a
// manifest of the PRODUCTION artifacts and the rehearsal set would have gone
// unhashed beside it. That is the §7.5 seam finding one level up: a rehearsal
// and its proof must ride the same bytes, and a rehearsal that reports on the
// wrong ones is worse than a rehearsal that cannot run.
//
// Driven, and pinned to the config, because there are two ways to break it
// and neither is a typo. The selection can invert or go stale (a rename in
// the config that nothing propagates here re-creates the exact defect), and
// the empty-string case can drift apart between the two files - the release
// lane feeds this variable from a secret that may be unset, and `-n ""` and
// JavaScript's `"" || null` have to keep agreeing that an empty selector is a
// PRODUCTION build.
{
    const selector = /\nif \[ -n "\$\{XCHAIN_STAGING_FEED_URL:-\}" \]; then\n(?:.*\n)*?fi\n/
        .exec(buildSh);
    assert.ok(selector,
        'build.sh must choose its manifest directory from `${XCHAIN_STAGING_FEED_URL:-}` in '
        + 'an if/fi block. The `:-` form is what keeps `set -u` off the production case, '
        + 'where the variable is absent entirely.');

    assert.ok(!/^cd \/workspace\/packages\/desktop\/dist$/m.test(buildSh),
        'build.sh still cds to a hard-coded packages/desktop/dist. Under '
        + 'XCHAIN_REPRODUCE_IN_PLACE=1 that path exists from the production build in the '
        + 'same job, so a rehearsal silently manifests the production artifacts instead of '
        + 'failing.');
    assert.ok(/^cd "\/workspace\/packages\/desktop\/\$\{DIST_DIR\}"$/m.test(buildSh),
        'build.sh does not cd into the directory its own selector chose, so the selector '
        + 'decides nothing.');

    /**
     * DIST_DIR and BUILD_VARIANT as build.sh's own block computes them, run
     * under the same `set -euo pipefail` the script uses. `null` means the
     * variable is absent from the environment, which is the production case.
     */
    function select(staging) {
        const script = ['set -euo pipefail', selector[0], 'printf "%s\\n%s\\n" "${DIST_DIR}" "${BUILD_VARIANT}"'].join('\n');
        const env = { ...process.env };
        if (staging === null) delete env.XCHAIN_STAGING_FEED_URL;
        else env.XCHAIN_STAGING_FEED_URL = staging;
        const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env });
        assert.equal(r.status, 0,
            `build.sh's output-directory selector does not evaluate cleanly: ${r.stderr}`);
        const [dir, variant] = r.stdout.split('\n');
        return { dir, variant };
    }

    // The config is the authority on both names; build.sh mirrors it, and this
    // is the assertion that fails when only one of the two is renamed.
    const config = read('packages/desktop/electron-builder.config.cjs');
    const outputs = /output:\s*isStaging \? '([^']+)' : '([^']+)'/.exec(config);
    assert.ok(outputs,
        "electron-builder.config.cjs no longer sets `directories.output` as "
        + "`isStaging ? '<staging>' : '<production>'`. build.sh mirrors that expression to "
        + 'find the artifacts it hashes; re-point this guard at whatever replaced it rather '
        + 'than deleting it.');
    const [, stagingDir, productionDir] = outputs;

    const STAGING = 'https://downloads.xchain.io/wallet/_rehearsal-7f3a91c2/desktop/';
    assert.deepEqual(select(STAGING), { dir: stagingDir, variant: 'staging' },
        `a rehearsal build does not manifest ${stagingDir}/, which is where `
        + 'electron-builder.config.cjs puts it. The manifest would cover whatever else is '
        + 'on disk.');
    for (const absent of [null, '']) {
        assert.deepEqual(select(absent), { dir: productionDir, variant: 'production' },
            'a production build does not manifest ' + productionDir + '/ when '
            + `XCHAIN_STAGING_FEED_URL is ${absent === null ? 'absent' : 'empty'}. The config `
            + 'reads that variable as `process.env.X || null`, so an empty selector is a '
            + 'production build there; the two files must not disagree about which build '
            + 'the release lane just made.');
    }

    // The variant reaches the reader, not just the shell. Both manifests carry
    // it, so a file on its own says which build it describes - the question a
    // maintainer holding two RELEASE_HASHES.txt files actually has.
    assert.equal((buildSh.match(/^ {4}echo "# variant: +\$\{BUILD_VARIANT\}"$/gm) || []).length, 2,
        'build.sh does not stamp `# variant:` into BOTH manifests. Without it the packaged '
        + 'and diagnostic manifests of a rehearsal are byte-shaped exactly like a release\'s '
        + 'and nothing in the file says otherwise.');
}

console.log('reproducible-toolchain smoke: ok');
