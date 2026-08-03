// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The reproducible build's PACKAGED manifest ( DD7).
//
// WHAT CHANGED AND WHY. `reproduce.sh` used to run electron-builder in
// `--dir` mode and hash the unpacked directory trees, while both
// REPRODUCIBLE_BUILDS.md and docs/Verify_Release.md ended the recipe by
// telling the verifier to diff that output against the release's published
// RELEASE_HASHES manifest. That comparison can never succeed: the
// published manifest covers packaged artifacts and the two sets share no
// filename. DD7's answer is to build what users actually download - the
// Linux artifacts carry no code signature, so unlike macOS and Windows
// they reproduce exactly as shipped.
//
// WHAT THIS DEFENDS. A manifest that covers three of four artifacts
// `sha256sum -c`s CLEAN, so the verifier's check passes while covering half
// the release. Coverage therefore has to be asserted by the build, and the
// assertion has one trap in it: electron-builder omits the arch token from
// the DEFAULT arch when artifactName is not user-forced, so the x64
// AppImage is `xchain-wallet-<v>.AppImage` with nothing to match on, and
// any pattern loose enough to find it also matches the arm64 file. The
// checker attributes each artifact to exactly one arch instead - the same
// answer tools/release/lib.sh gives on the release side.
//
// Driven against fixtures rather than a container: the container run takes
// tens of minutes and cannot be a gate, but every failure mode below is a
// property of the manifest text.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archOf, checkCoverage, parseManifest } from
    '../../../tools/build-reproduce/check-packaged-manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const checker = join(repo, 'tools', 'build-reproduce', 'check-packaged-manifest.mjs');
const buildSh = readFileSync(join(repo, 'packages', 'desktop', 'scripts', 'build.sh'), 'utf8');

const V = '0.333.1';
const H = (n) => String(n).repeat(64).slice(0, 64);

// The real names, as electron-builder emits them from the pinned config:
// deb is pinned to the Debian convention, and the x64 AppImage carries no
// arch token because that target's artifactName is not user-forced.
const FULL = [
    `${H(1)}  ./xchain-wallet-${V}-x86_64.AppImage`,
    `${H(2)}  ./xchain-wallet-${V}-arm64.AppImage`,
    `${H(3)}  ./xchain-wallet_${V}_amd64.deb`,
    `${H(4)}  ./xchain-wallet_${V}_arm64.deb`,
].join('\n');

const work = mkdtempSync(join(tmpdir(), 'xc998-pkgman-'));
let failures = 0;
const check = (label, cond, detail) => {
    if (cond) return;
    failures += 1;
    console.error(`FAIL ${label}${detail ? `\n     ${detail.trim().split('\n').join('\n     ')}` : ''}`);
};

// Run the real checker CLI, so the exit code is what the build sees.
function run(body, arches = ['x64', 'arm64']) {
    const file = join(work, `m-${Math.abs(hash(body))}.txt`);
    writeFileSync(file, `# header line, ignored\n${body}\n`);
    try {
        return { ok: true, out: execFileSync('node', [checker, file, ...arches],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) {
        return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
}
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

try {
    // --- 1. A complete packaged set passes ------------------------------
    {
        const r = run(FULL);
        check('a full packaged set passes', r.ok, r.out);
        check('and says what it covered', /AppImage \+ deb for x64, arm64/.test(r.out), r.out);
    }

    // --- 2. Each artifact dropped in turn -------------------------------
    const lines = FULL.split('\n');
    const NAMES = ['x64 AppImage', 'arm64 AppImage', 'x64 deb', 'arm64 deb'];
    for (let i = 0; i < lines.length; i += 1) {
        const r = run(lines.filter((_, j) => j !== i).join('\n'));
        check(`a missing ${NAMES[i]} fails the check`, !r.ok, r.out);
        check(`and explains that a short manifest verifies clean, for ${NAMES[i]}`,
            /verifies CLEAN|verifies clean/.test(r.out), r.out);
    }

    // --- 3. The trap: arm64 alone must not satisfy the x64 AppImage -----
    //
    // The whole reason this is a module and not a grep. Both AppImage
    // lines present except the untokened one, which is x64.
    {
        const r = run([
            `${H(2)}  ./xchain-wallet-${V}-arm64.AppImage`,
            `${H(3)}  ./xchain-wallet_${V}_amd64.deb`,
            `${H(4)}  ./xchain-wallet_${V}_arm64.deb`,
        ].join('\n'));
        check('an arm64-only AppImage set does not satisfy x64', !r.ok, r.out);
        check('and names the missing one', /no AppImage artifact for x64/.test(r.out), r.out);
    }

    // --- 4. A --dir build produces nothing this can pass on -------------
    //
    // The regression that would silently undo DD7: someone restores
    // `dist:unpacked` and the manifest goes back to unpacked paths.
    {
        const r = run([
            `${H(5)}  ./linux-unpacked/resources/app.asar`,
            `${H(6)}  ./linux-arm64-unpacked/resources/app.asar`,
        ].join('\n'));
        check('an unpacked-only manifest fails', !r.ok, r.out);
        check('and says a --dir build emits no packaged artifact',
            /--dir build emits none/.test(r.out), r.out);
    }

    // --- 5. Foreign and duplicate arches --------------------------------
    {
        const r = run([...lines, `${H(7)}  ./xchain-wallet-${V}-armv7l.AppImage`].join('\n'));
        check('an arch we do not ship is refused', !r.ok, r.out);
        check('and is named', /armv7l/.test(r.out), r.out);
    }
    {
        const r = run([...lines, `${H(8)}  ./xchain-wallet_${V}_arm64-2.deb`].join('\n'));
        check('two artifacts claiming one arch is refused', !r.ok, r.out);
        check('and says a verifier cannot tell which is which',
            /cannot tell which/.test(r.out), r.out);
    }

    // --- 6. The classifier's table --------------------------------------
    for (const [name, want] of [
        [`xchain-wallet-${V}-x86_64.AppImage`, 'x64'],
        [`xchain-wallet-${V}-x86_64.AppImage`, 'x64'],
        [`xchain-wallet-${V}-arm64.AppImage`, 'arm64'],
        [`xchain-wallet_${V}_amd64.deb`, 'x64'],
        [`xchain-wallet_${V}_arm64.deb`, 'arm64'],
        [`xchain-wallet_${V}_armhf.deb`, 'armv7l'],
        [`xchain-wallet-setup-${V}.exe`, null],
    ]) {
        check(`classifier: ${name} -> ${want}`, archOf(name) === want, `got ${archOf(name)}`);
    }

    // --- 7. The manifest parser tolerates the real header, not garbage --
    {
        const parsed = parseManifest(`# a comment\n\n${FULL}\n`);
        check('comments and blanks are skipped', parsed.length === 4, `got ${parsed.length}`);
        check('and the leading ./ is stripped',
            parsed[0].name.startsWith('xchain-wallet-'), parsed[0].name);
        let threw = false;
        try { parseManifest('not a manifest line\n'); } catch { threw = true; }
        check('a malformed line is refused rather than silently skipped', threw);
    }

    // --- 8. build.sh actually builds packaged artifacts -----------------
    //
    // The check above is worthless if the build stops producing the
    // artifacts it checks for, and that regression is one word wide.
    check('build.sh runs the packaging target, not --dir',
        /pnpm --filter @xchain-wallet\/desktop run dist --linux/.test(buildSh),
        'build.sh no longer invokes the packaging target');
    check('build.sh does not fall back to dist:unpacked',
        !/run dist:unpacked/.test(buildSh),
        'dist:unpacked is back; the published manifest would stop being comparable');
    check('build.sh runs the coverage checker',
        /check-packaged-manifest\.mjs/.test(buildSh),
        'nothing would catch a short manifest');
    check('build.sh still emits the diagnostic unpacked manifest',
        /UNPACKED_HASHES\.txt/.test(buildSh),
        'a packaged mismatch would be a 130MB binary diff with no way in');

    // Direct call, so the module is covered independently of the CLI.
    check('checkCoverage returns no problems for a full set',
        checkCoverage(parseManifest(FULL), ['x64', 'arm64']).length === 0);
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
    console.error(`\n${failures} packaged-manifest check(s) failed.`);
    process.exit(1);
}

console.log(
    'OK: packaged-manifest smoke ( DD7: the reproduce path builds the PACKAGED'
    + ' Linux artifacts, so its manifest carries the filenames the release publishes'
    + ' and the documented comparison can actually succeed; coverage is asserted per'
    + ' format per arch, so a short manifest cannot verify clean; the untokened x64'
    + ' AppImage is attributed rather than pattern-matched, so an arm64-only build'
    + ' cannot satisfy it; an unpacked-only manifest, a foreign arch and two'
    + ' artifacts claiming one arch are all refused by name; and build.sh is held to'
    + ' the packaging target plus both manifests)',
);
