// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Release parity for lanes that have already shipped ( §6,  §2).
//
// WHAT THIS EXISTS TO STOP. expected-artifacts.txt has two strengths per
// row, and every store lane starts `optional` because a lane that has
// never shipped cannot be demanded of a release built before it existed.
// Nothing about a first upload edits that file. So the release AFTER the
// first Android release could omit the Android pair entirely and produce
// a manifest that is internally perfect - every hash correct, signature
// good, verify.sh green - while every direct-APK install sits on a
// version that will never receive the fix it was told to expect.
//
// That is the  §8 defect one level up: the gate cannot fail on an
// artifact it was never told to want. tools/release/shipped-lanes.txt is
// where a lane's shipping state is declared, and flipping one word is
// what arms the requirement.
//
// Driven against the REAL lib.sh with real staged directories rather than
// read, because every question here is about what the gate does when a
// file is absent, and absence is not something source reading measures.
//
// Both drift directions are exercised too, since the whole value of the
// file is that it cannot go stale quietly:
//
//   a glob here that expected-artifacts.txt does not declare -> refused
//   an `optional` row there that no lane claims        -> refused
//   a status word that is neither SHIPPED nor NOT-SHIPPED -> refused,
//       and specifically NOT defaulted to the permissive one.

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
const lanesFile = join(repo, 'tools', 'release', 'shipped-lanes.txt');

const V = '0.333.1';

// The artifact set a release ships today: everything expected-artifacts.txt
// marks `required`. No mobile artifact is in it, which is the point.
const DESKTOP = [
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
    `xchain-wallet-${V}.AppImage`,
    `xchain-wallet-${V}-arm64.AppImage`,
    `xchain-wallet_${V}_amd64.deb`,
    `xchain-wallet_${V}_arm64.deb`,
];

const ANDROID_AAB = `xchain-wallet-android-v${V}.aab`;
const ANDROID_APK = `xchain-wallet-v${V}.apk`;

const work = mkdtempSync(join(tmpdir(), 'xc999-lanes-'));
let failures = 0;

function check(label, cond, detail) {
    if (cond) return;
    failures += 1;
    console.error(`FAIL ${label}${detail ? `\n     ${detail.trim().split('\n').join('\n     ')}` : ''}`);
}

function stage(extra = []) {
    const dir = mkdtempSync(join(work, 'stage-'));
    for (const name of [...DESKTOP, ...extra]) {
        writeFileSync(join(dir, name), `pretend ${name}\n`);
    }
    return dir;
}

// Write a variant lane list into the work dir and hand back its path.
function lanes(text) {
    const p = join(work, `lanes-${Math.abs(hash(text))}.txt`);
    writeFileSync(p, text);
    return p;
}

function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return h;
}

// Run the real gate. Returns { ok, out } rather than throwing: most cases
// here are meant to fail, and the message is the assertion.
function gate(dir, lanesPath = lanesFile, expectedPath = expected) {
    // `2>&1` because the gate reports on stderr in BOTH directions - the
    // "gate ok" line is stderr too, so without the merge a passing run
    // looks like a run that printed nothing.
    const script = `source ${JSON.stringify(lib)}; `
        + `xr_check_shipped_lanes ${JSON.stringify(dir)} `
        + `${JSON.stringify(lanesPath)} ${JSON.stringify(expectedPath)} 2>&1`;
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

// The committed lanes, so a variant can change one word without
// restating the file. Comments are dropped deliberately: this is testing
// the parser, and a lane list that only works with its prose attached
// would be a parser that reads prose. Every optional row in
// expected-artifacts.txt must be claimed here too, or the fixture fails
// the same claimed-by-no-lane check the real file would.
const BASE = [
    'android   NOT-SHIPPED   xchain-wallet-android-v*.aab xchain-wallet-v*.apk',
    'ios       NOT-SHIPPED   xchain-wallet-ios-v*.ipa',
    'mas       NOT-SHIPPED   *-mas.pkg',
    'msstore   NOT-SHIPPED   *-appx.appx',
    'snap      NOT-SHIPPED   *.snap',
];
const withAndroid = (status) => lanes(
    [BASE[0].replace('NOT-SHIPPED', status), ...BASE.slice(1)].join('\n') + '\n',
);

try {
    // 1. Today's release: nothing has shipped, so a desktop-only set passes.
    //    This is the case that must keep working, and it is why the row
    //    cannot simply be flipped to `required` now.
    {
        const r = gate(stage());
        check('a desktop-only release passes while every lane is NOT-SHIPPED',
            r.ok && /shipped-lane gate ok/.test(r.out), r.out);
    }

    // 2. The whole point. Android has shipped; this release forgot it.
    {
        const r = gate(stage(), withAndroid('SHIPPED'));
        check('once android is SHIPPED, a release with no Android artifact fails',
            !r.ok, r.out);
        check('...and it names BOTH halves of the pair',
            /xchain-wallet-android-v\*\.aab/.test(r.out)
            && /xchain-wallet-v\*\.apk/.test(r.out), r.out);
        check('...as a lane regression, not as an undeclared artifact',
            /LANE-REGRESSION/.test(r.out), r.out);
    }

    // 3. The same release with the pair staged passes, so the gate is
    //    demanding the artifacts and not merely rejecting the word.
    {
        const r = gate(stage([ANDROID_AAB, ANDROID_APK]), withAndroid('SHIPPED'));
        check('a SHIPPED android lane with both artifacts staged passes',
            r.ok && /shipped-lane gate ok/.test(r.out), r.out);
    }

    // 4. The asymmetric case  §6 is actually about: the store lane
    //    ships and the DIRECT lane is left behind. The AAB satisfies one
    //    glob; nothing about that should excuse the APK.
    {
        const r = gate(stage([ANDROID_AAB]), withAndroid('SHIPPED'));
        check('the AAB alone does not satisfy the lane: the direct APK is named',
            !r.ok && /xchain-wallet-v\*\.apk/.test(r.out), r.out);
        check('...and the AAB is not reported missing',
            !/LANE-REGRESSION[\s\S]*android-v\*\.aab/.test(r.out), r.out);
    }

    // 5. A typo in the status word must not disarm the requirement. This
    //    is the failure mode of every "if it says the magic word" gate:
    //    the permissive branch is the fall-through.
    {
        const r = gate(stage(), lanes(
            [BASE[0].replace('NOT-SHIPPED', 'shipped'), ...BASE.slice(1)].join('\n') + '\n',
        ));
        check('an unrecognized status word fails rather than defaulting',
            !r.ok && /expected SHIPPED or NOT-SHIPPED/.test(r.out), r.out);
    }

    // 6. Drift direction 1: this file cannot claim artifacts the release
    //    list has never heard of.
    {
        const r = gate(stage(), lanes(
            [...BASE, 'invented   NOT-SHIPPED   xchain-wallet-v*.sideload'].join('\n') + '\n',
        ));
        check('a glob no expected-artifacts row declares is refused',
            !r.ok && /which no row of/.test(r.out), r.out);
    }

    // 7. Drift direction 2, the one that keeps this honest as lanes are
    //    added: an optional artifact belonging to no lane has no shipping
    //    state at all, which is the hole the gate exists to close.
    {
        const r = gate(stage(), lanes(BASE.slice(0, 3).join('\n') + '\n'));
        check('an optional row claimed by no lane is refused',
            !r.ok && /no lane in/.test(r.out) && /appx/.test(r.out), r.out);
    }

    // 8. A gate that cannot run has not passed.
    {
        const r = gate(stage(), join(work, 'does-not-exist.txt'));
        check('a missing lane list is a hard failure, not a skip',
            !r.ok && /shipped-lane list not found/.test(r.out), r.out);
    }

    // 9. sign.sh must actually call it. A gate wired nowhere is prose.
    {
        const sign = readFileSync(join(repo, 'tools', 'release', 'sign.sh'), 'utf8');
        check('sign.sh runs the shipped-lane gate',
            /xr_check_shipped_lanes\s+"\$INPUT_DIR"/.test(sign), 'not called in sign.sh');
        check('...after the artifact-set gate, so an undeclared artifact is'
            + ' reported by the gate that understands it',
            sign.indexOf('xr_check_expected "$INPUT_DIR"')
                < sign.indexOf('xr_check_shipped_lanes "$INPUT_DIR"'));
    }

    // 10. The committed file, read as a claim about the world. Android is
    //     NOT-SHIPPED because nothing is on Play and the direct feed is
    //     404; when that stops being true this assertion is the reminder.
    {
        const text = readFileSync(lanesFile, 'utf8');
        const row = text.split('\n').find((l) => /^android\s/.test(l));
        check('the committed android row exists and declares both globs',
            !!row && /xchain-wallet-android-v\*\.aab/.test(row)
            && /xchain-wallet-v\*\.apk/.test(row), row ?? '<no android row>');
        check('every optional artifact in expected-artifacts.txt is claimed by a lane',
            gate(stage()).ok, 'the committed pair does not agree');
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
    console.error(`\n${failures} shipped-lane check(s) failed.`);
    process.exit(1);
}

assert.ok(true);
console.log(
    'OK: release shipped-lane smoke ( §6,  §2:'
    + ' tools/release/shipped-lanes.txt declares which lanes have users, and'
    + ' sign.sh refuses a release that drops one; a desktop-only release still'
    + ' passes while every lane is NOT-SHIPPED, so the Android rows can stay'
    + ' optional until the first upload; flipping android to SHIPPED makes a'
    + ' release with no Android artifact fail by name, and the store AAB alone'
    + ' does not excuse the missing direct APK; a mistyped status word fails'
    + ' instead of falling through to the permissive branch; and the two files'
    + ' cannot drift - a lane glob no release row declares, and an optional'
    + ' release row no lane claims, are both refused)',
);
