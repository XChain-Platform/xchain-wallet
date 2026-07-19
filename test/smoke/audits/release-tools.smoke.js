// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §51 / G003: `tools/release/` scaffolding.
//
// The full GPG-signing path lands when the release key is published
// (G180). This smoke pins the scaffolding shape so a future edit
// cannot silently drop a piece (directory + scripts + README), plus
// the friendly "GPG key not configured" exit path that the scripts
// promise pre-G180.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. Directory + scripts exist with the expected metadata.
const dir = 'tools/release';
const files = [
    'tools/release/README.md',
    'tools/release/sign.sh',
    'tools/release/verify.sh',
];
for (const p of files) {
    assert.ok(existsSync(join(root, p)), `${p} exists`);
}

for (const p of ['tools/release/sign.sh', 'tools/release/verify.sh']) {
    const st = statSync(join(root, p));
    assert.ok((st.mode & 0o111) !== 0,
        `${p} has the executable bit set`);
}

// 2. README documents the key constants.
const readme = read('tools/release/README.md');
for (const heading of [
    '# Release-signing pipeline',
    '## Inputs',
    '## Scripts',
    '## Environment variables',
    '## Per-release procedure',
    '## Status today',
]) {
    assert.ok(readme.includes(heading), `README has heading: ${heading}`);
}
assert.ok(/XCHAIN_RELEASE_GPG_KEY/.test(readme),
    'README documents the canonical env var');
assert.ok(/G180/.test(readme),
    'README cites G180 (release-key publication gate)');
assert.ok(/§51/.test(readme),
    'README cites §51');

// 3. sign.sh + verify.sh have the expected shape (set -euo pipefail,
//    --input + --force / --no-sig / --recompute flags, GPG key gate).
const signSrc = read('tools/release/sign.sh');
assert.ok(/^#!\/usr\/bin\/env bash/.test(signSrc), 'sign.sh has bash shebang');
assert.ok(/set -euo pipefail/.test(signSrc), 'sign.sh has strict-mode guard');
assert.ok(/XCHAIN_RELEASE_GPG_KEY/.test(signSrc), 'sign.sh references the GPG key env var');
assert.ok(/G180/.test(signSrc), 'sign.sh cites G180 in its diagnostic');
assert.ok(/--input/.test(signSrc) && /--force/.test(signSrc),
    'sign.sh accepts --input and --force flags');
assert.ok(/RELEASE_HASHES\.txt\.asc/.test(signSrc),
    'sign.sh writes the .asc detached signature');
assert.ok(/find \. -maxdepth 1 -type f/.test(signSrc),
    'sign.sh hashes top-level files only');
assert.ok(/LC_ALL=C sort/.test(signSrc),
    'sign.sh sorts deterministically (LC_ALL=C) for reproducibility');

const verifySrc = read('tools/release/verify.sh');
assert.ok(/^#!\/usr\/bin\/env bash/.test(verifySrc), 'verify.sh has bash shebang');
assert.ok(/set -euo pipefail/.test(verifySrc), 'verify.sh has strict-mode guard');
assert.ok(/--no-sig/.test(verifySrc) && /--recompute/.test(verifySrc),
    'verify.sh accepts --no-sig and --recompute');
assert.ok(/gpg --verify/.test(verifySrc),
    'verify.sh runs gpg --verify');
assert.ok(/sha256sum -c|shasum -a 256 -c/.test(verifySrc),
    'verify.sh runs sha256sum -c (or shasum -a 256 -c)');

// 4. Runtime: verify.sh --recompute writes a deterministic manifest
//    over a tiny fake artifact set; sign.sh without GPG key set exits
//    with code 1 and the documented diagnostic.
const stage = mkdtempSync(join(tmpdir(), 'xc-release-tools-'));
try {
    writeFileSync(join(stage, 'sample.bin'), 'fake artifact\n');
    writeFileSync(join(stage, 'b-second.bin'), 'second\n');

    // verify.sh --recompute writes the manifest.
    const recompute = spawnSync('bash', [join(root, 'tools/release/verify.sh'), '--input', stage, '--recompute'], {
        encoding: 'utf8',
    });
    assert.equal(recompute.status, 0, `verify.sh --recompute exited 0 (got ${recompute.status})`);
    assert.ok(existsSync(join(stage, 'RELEASE_HASHES.txt')),
        'verify.sh --recompute writes RELEASE_HASHES.txt');
    const manifest = readFileSync(join(stage, 'RELEASE_HASHES.txt'), 'utf8');
    assert.ok(manifest.includes('./sample.bin'),
        'manifest includes sample.bin');
    assert.ok(manifest.includes('./b-second.bin'),
        'manifest includes b-second.bin');
    // Sorted: b-second.bin should appear before sample.bin since
    // file order is LC_ALL=C sorted.
    const bIdx = manifest.indexOf('./b-second.bin');
    const sIdx = manifest.indexOf('./sample.bin');
    assert.ok(bIdx >= 0 && sIdx >= 0 && bIdx < sIdx,
        'manifest is sorted deterministically');

    // verify.sh --no-sig validates the recomputed manifest without
    // requiring the .asc file.
    const noSig = spawnSync('bash', [join(root, 'tools/release/verify.sh'), '--input', stage, '--no-sig'], {
        encoding: 'utf8',
    });
    assert.equal(noSig.status, 0, `verify.sh --no-sig exited 0 (got ${noSig.status})`);

    // sign.sh without XCHAIN_RELEASE_GPG_KEY: exits 1 with the
    // documented diagnostic.
    const env = { ...process.env };
    delete env.XCHAIN_RELEASE_GPG_KEY;
    const noKey = spawnSync('bash', [join(root, 'tools/release/sign.sh'), '--input', stage], {
        encoding: 'utf8',
        env,
    });
    assert.equal(noKey.status, 1,
        `sign.sh without GPG key exits 1 (got ${noKey.status})`);
    assert.ok(/XCHAIN_RELEASE_GPG_KEY is not set/.test(noKey.stderr),
        'sign.sh diagnostic mentions XCHAIN_RELEASE_GPG_KEY');
    assert.ok(/G180/.test(noKey.stderr),
        'sign.sh diagnostic cites G180');

    // sign.sh --help / verify.sh --help return 0 + non-empty output.
    const helpSign = spawnSync('bash', [join(root, 'tools/release/sign.sh'), '--help'], { encoding: 'utf8' });
    assert.equal(helpSign.status, 0);
    assert.ok(helpSign.stdout.length > 0, 'sign.sh --help prints docs');

    const helpVerify = spawnSync('bash', [join(root, 'tools/release/verify.sh'), '--help'], { encoding: 'utf8' });
    assert.equal(helpVerify.status, 0);
    assert.ok(helpVerify.stdout.length > 0, 'verify.sh --help prints docs');
} finally {
    rmSync(stage, { recursive: true, force: true });
}

// 5.  wiring: pnpm release:sign wrapper + pre-sign dev-mock gate.
const rootPkg = JSON.parse(read('package.json'));
assert.ok(rootPkg.scripts['release:sign'],
    'root package.json has a release:sign script');
assert.ok(/tools\/release\/sign\.sh/.test(rootPkg.scripts['release:sign']),
    'release:sign wraps tools/release/sign.sh');
assert.ok(/release-artifacts\//.test(rootPkg.scripts['release:sign']),
    'release:sign targets release-artifacts/<version>');
assert.ok(rootPkg.scripts['release:verify'] &&
    /tools\/release\/verify\.sh/.test(rootPkg.scripts['release:verify']),
    'root package.json has a release:verify wrapper');
assert.ok(rootPkg.scripts['test:integration:regtest'] &&
    /tools\/regtest\/test-integration\.sh/.test(rootPkg.scripts['test:integration:regtest']),
    'root package.json has the regtest integration driver script');
// The default test:integration stays network-free (must not gate on regtest).
assert.ok(!/wait-ready|regtest/.test(rootPkg.scripts['test:integration']),
    'default test:integration stays network-free (no regtest gate)');

assert.ok(/check-no-dev-mock\.sh/.test(signSrc),
    'sign.sh runs the pre-sign dev-mock gate');
assert.ok(/SIGN_SKIP_DEV_MOCK_CHECK/.test(signSrc),
    'sign.sh exposes the SIGN_SKIP_DEV_MOCK_CHECK escape hatch');

// 6.  wiring: the regtest integration driver gates on wait-ready.
const driverSrc = read('tools/regtest/test-integration.sh');
assert.ok(/^#!\/usr\/bin\/env bash/.test(driverSrc), 'driver has bash shebang');
assert.ok(/set -euo pipefail/.test(driverSrc), 'driver has strict-mode guard');
assert.ok(/wait-ready\.sh/.test(driverSrc),
    'driver gates on wait-ready.sh before running tests');
assert.ok((statSync(join(root, 'tools/regtest/test-integration.sh')).mode & 0o111) !== 0,
    'driver has the executable bit set');

// 7.  wiring: per-target reproduce scripts for extension + web.
for (const shell of ['web', 'extension']) {
    const repro = `packages/${shell}/scripts/reproduce.sh`;
    const buildSh = `packages/${shell}/scripts/build.sh`;
    const dockerfile = `packages/${shell}/Dockerfile`;
    for (const p of [repro, buildSh, dockerfile, `packages/${shell}/REPRODUCIBLE_BUILDS.md`]) {
        assert.ok(existsSync(join(root, p)), `${p} exists`);
    }
    for (const p of [repro, buildSh]) {
        assert.ok((statSync(join(root, p)).mode & 0o111) !== 0,
            `${p} has the executable bit set`);
    }
    const reproSrc = read(repro);
    assert.ok(/set -euo pipefail/.test(reproSrc), `${repro} has strict-mode guard`);
    assert.ok(/SOURCE_DATE_EPOCH/.test(reproSrc),
        `${repro} injects SOURCE_DATE_EPOCH`);
    assert.ok(/git worktree add/.test(reproSrc),
        `${repro} builds from an isolated worktree`);
    assert.ok(new RegExp(`packages/${shell}/Dockerfile`).test(reproSrc),
        `${repro} references its shell Dockerfile`);

    const buildSrc = read(buildSh);
    assert.ok(/--frozen-lockfile/.test(buildSrc),
        `${buildSh} installs with --frozen-lockfile`);
    assert.ok(/check-no-dev-mock\.sh/.test(buildSrc),
        `${buildSh} runs the dev-mock gate before emitting a manifest`);
    assert.ok(/sha256sum/.test(buildSrc) && /RELEASE_HASHES\.txt/.test(buildSrc),
        `${buildSh} emits a SHA-256 RELEASE_HASHES.txt manifest`);

    const dockerSrc = read(dockerfile);
    assert.ok(/@sha256:/.test(dockerSrc),
        `${dockerfile} pins its base image by digest`);
    assert.ok(/NODE_SHA256=/.test(dockerSrc),
        `${dockerfile} SHA256-verifies the Node tarball`);

    const shellPkg = JSON.parse(read(`packages/${shell}/package.json`));
    assert.ok(shellPkg.scripts.reproduce &&
        /scripts\/reproduce\.sh/.test(shellPkg.scripts.reproduce),
        `packages/${shell}/package.json has a reproduce script`);
}

console.log('OK: tools/release/ scaffolding smoke (incl.  release/reproduce wiring)');
