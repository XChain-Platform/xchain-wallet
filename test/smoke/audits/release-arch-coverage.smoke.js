// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Per-architecture coverage in the release gate (§8).
//
// WHAT THIS EXISTS TO STOP, in the words of the defect that caused it.
// Every desktop release lane read `pnpm -C packages/desktop dist -- --linux
// --x64 --arm64`. pnpm 9 forwards that `--` into argv verbatim, yargs ends
// option parsing at it, and electron-builder packaged the runner's own arch
// and nothing else. All six lanes, for as long as they had existed. The
// separator is gone and a smoke refuses to reintroduce it - but the reason
// nobody NOTICED for that long was this gate: expected-artifacts.txt matched
// `*.dmg`, one dmg satisfied it, and a release with no arm64 anything
// produced a manifest that was internally perfect.
//
// The fix is a fourth column and the arch classifier behind it. This file
// drives the real lib.sh against staged directories rather than reading it,
// because every question here is about how a NAME classifies, and that is
// answered by electron-builder's naming rules and not by intent.
//
// Two failure directions, and the second is the one opened:
//
//   MISSING-ARCH   a declared arch has no artifact. The release is half a
//                  release and the other half's fleet has no download.
//   UNATTRIBUTED   an artifact matches an arch-partitioned row and carries
//                  no arch token, so it belongs to no fleet. The combined
//                  NSIS installer is one; a broken artifactName is the
//                  other, and they look identical from here.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const lib = join(repo, 'tools', 'release', 'lib.sh');
const expected = join(repo, 'tools', 'release', 'expected-artifacts.txt');

const V = '0.333.1';

// Escapes every regex metacharacter (not just '*') so a literal string can
// be embedded in `new RegExp()` without a stray backslash in the input
// changing how the following character is interpreted.
function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The real names, as electron-builder emits them from the pinned config:
// EVERY artifactName is user-forced since §7.1's rename, so every artifact
// carries its arch on BOTH arches and is lowercase-with-dashes. The deb keeps
// fpm's Debian convention (`_amd64` / `_arm64`) and the AppImage keeps
// electron-builder's Linux arch spelling (`x86_64`); both are that tooling's
// names, not ours. There is no longer an un-suffixed artifact anywhere, which
// is why lib.sh no longer has a default-arch exception to apply.
const FULL = [
    `xchain-wallet-web-v${V}.tar.gz`,
    `xchain-wallet-extension-v${V}.zip`,
    `xchain-wallet-${V}-x64.dmg`,
    `xchain-wallet-${V}-arm64.dmg`,
    `xchain-wallet-${V}-x64-mac.zip`,
    `xchain-wallet-${V}-arm64-mac.zip`,
    `xchain-wallet-setup-${V}-x64.exe`,
    `xchain-wallet-setup-${V}-arm64.exe`,
    `xchain-wallet-${V}-x64-win.zip`,
    `xchain-wallet-${V}-arm64-win.zip`,
    `xchain-wallet-${V}-x86_64.AppImage`,
    `xchain-wallet-${V}-arm64.AppImage`,
    `xchain-wallet_${V}_amd64.deb`,
    `xchain-wallet_${V}_arm64.deb`,
];

const work = mkdtempSync(join(tmpdir(), 'xc998-arch-'));
let failures = 0;

function check(label, cond, detail) {
    if (cond) return;
    failures += 1;
    console.error(`FAIL ${label}${detail ? `\n     ${detail.trim().split('\n').join('\n     ')}` : ''}`);
}

// Stage a directory holding FULL, minus `drop`, plus `add`.
function stage(drop = [], add = []) {
    const dir = mkdtempSync(join(work, 'stage-'));
    for (const name of FULL) {
        if (drop.includes(name)) continue;
        writeFileSync(join(dir, name), `pretend ${name}\n`);
    }
    for (const name of add) writeFileSync(join(dir, name), `pretend ${name}\n`);
    return dir;
}

// Run the real gate. Returns { ok, out } rather than throwing: most cases
// here are meant to fail, and the message is the assertion.
function gate(dir, list = expected) {
    // `2>&1` because the gate reports on stderr in BOTH directions: the
    // "gate ok" line is stderr too, and without the merge a passing run
    // looks like a run that printed nothing.
    const script = `source ${JSON.stringify(lib)}; `
        + `xr_check_expected ${JSON.stringify(dir)} ${JSON.stringify(list)} 2>&1`;
    try {
        return {
            ok: true,
            out: execFileSync('bash', ['-c', script], {
                encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
            }),
        };
    } catch (err) {
        return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
}

// Ask lib.sh's classifier directly what a name attributes to.
function archOf(name) {
    return execFileSync('bash', ['-c',
        `source ${JSON.stringify(lib)}; xr_artifact_arch ${JSON.stringify(name)}`,
    ], { encoding: 'utf8' }).trim();
}

try {
    // --- 0. The committed list still passes on a real full matrix ------
    //
    // First, because everything below is only meaningful if the honest
    // release shape is the one that passes.
    {
        const r = gate(stage());
        check('the full 6-lane matrix passes the gate', r.ok, r.out);
        check('and the gate counts every artifact', /gate ok \(14 artifact\(s\)\)/.test(r.out), r.out);
    }

    // --- 1. Every lane, dropped one arch at a time ---------------------
    //
    // Six lanes x 2 arches. Driven individually rather than as one
    // "drop everything arm64" case, because the whole failure mode was a
    // single row satisfying itself with the wrong arch.
    const DROPS = [
        ['*.dmg', 'x64', `xchain-wallet-${V}-x64.dmg`],
        ['*.dmg', 'arm64', `xchain-wallet-${V}-arm64.dmg`],
        ['*mac*.zip', 'x64', `xchain-wallet-${V}-x64-mac.zip`],
        ['*mac*.zip', 'arm64', `xchain-wallet-${V}-arm64-mac.zip`],
        ['*.exe', 'x64', `xchain-wallet-setup-${V}-x64.exe`],
        ['*.exe', 'arm64', `xchain-wallet-setup-${V}-arm64.exe`],
        ['*win*.zip', 'x64', `xchain-wallet-${V}-x64-win.zip`],
        ['*win*.zip', 'arm64', `xchain-wallet-${V}-arm64-win.zip`],
        ['*.AppImage', 'x64', `xchain-wallet-${V}-x86_64.AppImage`],
        ['*.AppImage', 'arm64', `xchain-wallet-${V}-arm64.AppImage`],
        ['*.deb', 'x64', `xchain-wallet_${V}_amd64.deb`],
        ['*.deb', 'arm64', `xchain-wallet_${V}_arm64.deb`],
    ];
    for (const [pattern, arch, file] of DROPS) {
        const r = gate(stage([file]));
        check(`a missing ${arch} artifact for ${pattern} fails the gate`, !r.ok, r.out);
        // The row still matches the OTHER arch, so the pre-existing
        // MISSING check stays silent - this message is the only one.
        check(`and it says which arch, for ${pattern} ${arch}`,
            new RegExp(`MISSING-ARCH\\s+pattern '\\${escapeRegExp(pattern)}' has no ${arch}`)
                .test(r.out.replace(/\\\*/g, '*')) || r.out.includes(`has no ${arch} artifact`),
            r.out);
    }

    // --- 2. The combined NSIS installer ----------------------
    //
    // The real one, from the first successful Windows build: 193M holding
    // both arches, un-suffixed. The operator decided on 2026-08-01 to ship
    // ONLY the two per-arch installers, so `nsis.buildUniversalInstaller:
    // false` stops it being produced and this gate is the backstop: if it
    // appears anyway, the suppression flag has been lost and the release
    // must fail rather than put a third file on the feed.
    {
        const r = gate(stage([], [`xchain-wallet-setup-${V}.exe`]));
        check('the combined NSIS installer fails the gate', !r.ok, r.out);
        check('and is reported as unattributable, not as a missing arch',
            /UNATTRIBUTED.*setup-0\.333\.1\.exe/s.test(r.out), r.out);
        check('and the message names and both ways out',
            /combined-installer arch row/.test(r.out) && /multi/.test(r.out), r.out);
    }

    // --- 3. `multi` is the declared escape hatch, and only that --------
    //
    // If decides to publish the combined installer, one column
    // says so. The point of testing it is that the allowance must not
    // also excuse a MISSING arch: a row declaring `multi` still has to
    // produce both real installers.
    {
        const list = join(work, 'expected-multi.txt');
        writeFileSync(list, [
            'required  *.dmg        default  x64,arm64',
            'required  *mac*.zip    default  x64,arm64',
            'required  *.exe        default  x64,arm64,multi',
            'required  *win*.zip    default  x64,arm64',
            'required  *.AppImage   default  x64,arm64',
            'required  *.deb        default  x64,arm64',
            'required  xchain-wallet-web-v*.tar.gz     default  -',
            'required  xchain-wallet-extension-v*.zip  default  -',
            '',
        ].join('\n'));

        let r = gate(stage([], [`xchain-wallet-setup-${V}.exe`]), list);
        check('a declared `multi` allowance accepts the combined installer', r.ok, r.out);

        r = gate(stage([`xchain-wallet-setup-${V}-arm64.exe`],
            [`xchain-wallet-setup-${V}.exe`]), list);
        check('but `multi` never substitutes for a real arch', !r.ok, r.out);
        check('and says so as a missing arch', /MISSING-ARCH.*arm64/s.test(r.out), r.out);
    }

    // --- 3b. Two artifacts claiming one architecture --------------------
    //
    // The coverage check only asks whether each arch appears AT LEAST
    // once, so a duplicate reads as healthy. The live example is
    // electron-builder's NSIS uninstaller intermediate, ~100M, sitting in
    // dist/ next to the real installer while the build runs: it matches
    // `*.exe`, classifies as x64, and would have been hashed into the
    // manifest and published as a second, unrunnable "installer". A
    // successful build removes it (measured on a real Windows build), so
    // this guards the case we would have had no way to see.
    {
        const r = gate(stage([], [`xchain-wallet-setup-${V}-x64.__uninstaller.exe`]));
        check('a second x64 .exe fails the gate', !r.ok, r.out);
        check('and is named as a duplicate, not a missing arch',
            /DUPLICATE-ARCH.*claim x64/s.test(r.out), r.out);
        check('and says the list cannot pick between them',
            /which one is the release artifact/.test(r.out), r.out);
    }
    {
        // The same on a row whose two arches are named differently, so the
        // check is not quietly keyed to the exe naming.
        const r = gate(stage([], [`xchain-wallet_${V}_arm64-2.deb`]));
        check('a second arm64 .deb fails the gate', !r.ok, r.out);
        check('and is named as a duplicate', /DUPLICATE-ARCH.*claim arm64/s.test(r.out), r.out);
    }

    // --- 4. An arch we do not ship must not be laundered into one ------
    //
    // The AppImage exception ("no token means x64") is the one place the
    // classifier infers rather than reads, so it is the one place a
    // foreign arch could be counted as the x64 build. armv7l is the live
    // example: DD1 leaves it post-launch, and an armv7l AppImage passing
    // as the x64 lane would put a binary no x64 machine can run behind
    // the x64 pointer.
    {
        const r = gate(stage([`xchain-wallet-${V}-x86_64.AppImage`],
            [`xchain-wallet-${V}-armv7l.AppImage`]));
        check('an armv7l AppImage does not satisfy the x64 lane', !r.ok, r.out);
        check('and is named as an arch the row does not declare',
            /UNEXPECTED-ARCH.*armv7l/s.test(r.out), r.out);
    }
    // --- 4b. An un-suffixed AppImage is a LOST NAME, not the x64 build ---
    //
    // This is the case §7.1's rename inverted. While the AppImage was the
    // one target left at electron-builder's default pattern, its x64 build
    // genuinely had no arch token and the gate had to read a bare
    // `.AppImage` as x64. Every target is user-forced now, so the same file
    // means the opposite thing: the forced name was lost, exactly as a
    // returning combined NSIS installer would mean the suppression flag was
    // lost. It must fail rather than be inferred.
    {
        const r = gate(stage([`xchain-wallet-${V}-x86_64.AppImage`],
            [`xchain-wallet-${V}.AppImage`]));
        check('an un-suffixed AppImage no longer passes as the x64 build', !r.ok, r.out);
        check('and is reported as unattributable rather than guessed at',
            /UNATTRIBUTED.*\.AppImage.*carries no architecture token/s.test(r.out), r.out);
    }
    {
        // Same shape, the other declined arch: win-ia32 is refused by
        // policy (§2, EOL OS), so `ia32` is not even a declarable token.
        const r = gate(stage([], [`xchain-wallet-setup-${V}-ia32.exe`]));
        check('an ia32 installer cannot be declared into the matrix', !r.ok, r.out);
        check('and reports as ia32 rather than as unattributable',
            /UNEXPECTED-ARCH.*ia32/s.test(r.out), r.out);
    }

    // --- 5. The classifier's own table ---------------------------------
    //
    // Asserted directly, because these mappings are electron-builder's
    // (`builder-util getArtifactArchName`) and not ours: if a builder
    // upgrade changes one, this is where it surfaces, rather than in a
    // release that is missing an arch nobody can find.
    const CLASSIFY = [
        [`xchain-wallet-${V}-x64.dmg`, 'x64'],
        [`xchain-wallet-${V}-arm64.dmg`, 'arm64'],
        [`xchain-wallet_${V}_amd64.deb`, 'x64'],
        [`xchain-wallet_${V}_arm64.deb`, 'arm64'],
        [`xchain-wallet-${V}-x86_64.AppImage`, 'x64'],
        [`xchain-wallet-${V}-x86_64.AppImage`, 'x64'],
        [`xchain-wallet-${V}-arm64.AppImage`, 'arm64'],
        [`xchain-wallet-setup-${V}.exe`, ''],
        [`xchain-wallet-${V}-universal.dmg`, 'universal'],
        [`xchain-wallet-${V}-armv7l.AppImage`, 'armv7l'],
    ];
    for (const [name, want] of CLASSIFY) {
        const got = archOf(name);
        check(`classifier: ${name} -> ${want || '(nothing)'}`, got === want, `got '${got}'`);
    }

    // --- 6. The declaration itself fails closed -------------------------
    //
    // A row with no arch column would silently restore the old behaviour
    // on that row, which is the exact defect. It has to be a parse-time
    // failure, like the profile column, so the release that discovers it
    // is the one being declared rather than the one already staged.
    {
        const list = join(work, 'expected-no-arch.txt');
        writeFileSync(list, 'required  *.dmg  default\n');
        const r = gate(stage(), list);
        check('a row with no arch column is refused', !r.ok, r.out);
        check('and the message says how to say "not arch-partitioned"',
            /declares no arch column/.test(r.out) && /'-'/.test(r.out), r.out);
    }
    {
        const list = join(work, 'expected-bad-arch.txt');
        writeFileSync(list, 'required  *.dmg  default  x64,amd64\n');
        const r = gate(stage(), list);
        check('an unknown arch token is refused', !r.ok, r.out);
        check('and names the token', /declares arch 'amd64'/.test(r.out), r.out);
    }

    // --- 7. The committed list covers every lane the matrix ships ------
    //
    // A guard on the DECLARATION rather than on a staged directory: the
    // way this regresses is not a broken classifier, it is someone
    // relaxing a row back to `-` to make a red release go green.
    {
        const text = execFileSync('bash', ['-c', `cat ${JSON.stringify(expected)}`],
            { encoding: 'utf8' });
        for (const pattern of ['*.dmg', '*mac*.zip', '*.exe', '*win*.zip', '*.AppImage', '*.deb']) {
            const row = text.split('\n').find((l) => l.startsWith('required')
                && l.split(/\s+/)[1] === pattern);
            check(`the committed list still declares ${pattern}`, !!row, 'row is gone');
            if (!row) continue;
            const arches = row.split(/\s+/)[3] || '';
            check(`${pattern} still requires both shipped arches`,
                arches.split(',').includes('x64') && arches.split(',').includes('arm64'),
                `arch column is '${arches}'`);
        }

        // NO row declares `multi` (operator 2026-08-01: ship only
        // the two per-arch installers). The token exists and is driven in
        // case 3 above, but the moment a committed row carries it, some
        // artifact is being waved through unattributed - and the one
        // candidate we know of is suppressed at the source instead.
        const withMulti = text.split('\n')
            .filter((l) => /^(required|optional)\s/.test(l))
            .filter((l) => (l.split(/\s+/)[3] || '').split(',').includes('multi'))
            .map((l) => l.split(/\s+/)[1]);
        check('no committed row declares the `multi` allowance',
            withMulti.length === 0,
            `rows declaring multi: ${withMulti.join(', ')}`);
    }

    // --- 9. The combined installer is suppressed at the source ---------
    //
    // The gate above is the backstop. The mechanism is one config line,
    // and it is worth asserting here rather than only in the desktop
    // config smoke, because losing it is what would make case 2 start
    // failing real releases instead of catching a mistake.
    {
        const cfg = readFileSync(join(repo, 'packages', 'desktop',
            'electron-builder.config.cjs'), 'utf8');
        check('nsis.buildUniversalInstaller is off',
            /buildUniversalInstaller:\s*false/.test(cfg),
            'the un-suffixed both-arch installer would be emitted again');
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
    console.error(`\n${failures} arch-coverage check(s) failed.`);
    process.exit(1);
}

console.log(
    'OK: release arch-coverage smoke (§8,: expected-artifacts.txt'
    + ' carries a fourth arch column; dropping either arch of any of the six'
    + ' desktop lanes fails the gate by name; the un-suffixed combined NSIS'
    + ' installer is suppressed at the source (operator 2026-08-01) and'
    + ' refused as unattributable by this gate if it ever returns, with no'
    + ' committed row declaring the `multi` allowance; a declared `multi` would'
    + ' tolerate such a file without excusing a missing arch; two artifacts'
    + ' claiming one architecture are refused rather than picked between, which'
    + " is what a build intermediate left in the staging directory looks like; an"
    + ' armv7l or ia32 artifact cannot be laundered into the x64 lane, and since'
    + " §7.1's rename every artifactName is user-forced, so an un-suffixed"
    + ' AppImage is refused as unattributable rather than read as the x64 build;'
    + ' and a row with a missing or unknown arch column fails at parse time)',
);
