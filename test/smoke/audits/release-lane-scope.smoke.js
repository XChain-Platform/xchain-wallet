// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Per-lane (partial) release signing .
//
// WHAT THIS EXISTS TO MAKE POSSIBLE. sign.sh signs ONE manifest for a
// whole release, and the artifact-set gate in front of it demands every
// `required` row: web, extension, and both architectures of six desktop
// artifacts. On 2026-08-06 the Android ceremony produced a real signed
// AAB and APK and the next documented step - sign the manifest - could
// not run at all: an Android-only staging directory fails that gate with
// twenty problems, and no per-lane mode existed. The ceremony's own
// closing line told the operator to run a command that cannot succeed.
//
// WHAT IT MUST NOT COST. The gate exists to refuse "a manifest that is
// internally perfect and describes a release that was never built". A
// per-lane mode that simply relaxed the gate would hand that property
// back for free. So the scope is DERIVED from shipped-lanes.txt rather
// than passed as a list of globs, and inside its scope it is STRICTER
// than the full list:
//
//   * every glob the named lanes claim becomes `required`, even where
//     expected-artifacts.txt calls it optional - a lane is optional to a
//     RELEASE, never to itself, and the Android pair is one build;
//   * every row the named lanes do NOT claim is dropped, so an artifact
//     from another lane staged into the directory is UNDECLARED and hard
//     fails, exactly as it would in a full release;
//   * a lane name that is not declared in shipped-lanes.txt fails rather
//     than silently narrowing the release to nothing;
//   * the manifest says so in its signed header (`# coverage: partial`,
//     `# lanes: ...`), so no reader can mistake a one-lane manifest for
//     evidence about a release it never covered.
//
// Driven against the REAL lib.sh, sign.sh and verify.sh with real staged
// directories, because every question here is about what the gates do
// when a file is absent, and absence is not something source reading
// measures.

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

const V = '0.336.0';
const AAB = `xchain-wallet-android-v${V}.aab`;
const APK = `xchain-wallet-v${V}.apk`;
const WEB = `xchain-wallet-web-v${V}.tar.gz`;

const work = mkdtempSync(join(tmpdir(), 'xc999-lane-scope-'));
let failures = 0;

function check(label, cond, detail) {
    if (cond) return;
    failures += 1;
    console.error(`FAIL ${label}${detail ? `\n     ${detail.trim().split('\n').join('\n     ')}` : ''}`);
}

function stage(names) {
    const dir = mkdtempSync(join(work, 'stage-'));
    for (const name of names) writeFileSync(join(dir, name), `pretend ${name}\n`);
    return dir;
}

// Run a bash snippet with lib.sh sourced. Returns { ok, out } rather than
// throwing: most cases here are meant to fail, and the message IS the
// assertion. stderr is merged because these gates report in both
// directions on stderr - without the merge a passing run looks silent.
function sh(snippet) {
    const script = `source ${JSON.stringify(lib)}; ${snippet}`;
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

// Derive a scoped list and leave it on disk so the gates can be pointed
// at exactly the bytes sign.sh would point them at.
function scope(lanes, { lanesPath = lanesFile, expectedPath = expected } = {}) {
    const out = join(work, `scope-${lanes.join('-')}-${Math.random().toString(36).slice(2)}.txt`);
    const r = sh(`xr_lane_scope ${JSON.stringify(lanesPath)} ${JSON.stringify(expectedPath)} `
        + `${lanes.map((l) => JSON.stringify(l)).join(' ')} > ${JSON.stringify(out)} 2>&1`);
    // On success stdout went to the file, so read it back; on failure the
    // diagnostics landed there instead and are what the caller wants.
    return { ok: r.ok, path: out, out: readFileSync(out, 'utf8') };
}

function gate(dir, expectedPath) {
    return sh(`xr_check_expected ${JSON.stringify(dir)} ${JSON.stringify(expectedPath)} 2>&1`);
}

try {
    // 1. The scope itself: android resolves to its two globs, both
    //    required, both carrying the source list's profile and arch
    //    columns. The promotion to `required` is the whole mechanism -
    //    without it the scoped list would demand nothing and pass an
    //    empty directory.
    {
        const s = scope(['android']);
        check('a lane scope is derivable for android', s.ok, s.out);
        const rows = s.out.split('\n').filter((l) => l && !l.startsWith('#'));
        check('...and it carries exactly the two android rows',
            rows.length === 2, s.out);
        check('...both promoted to required',
            rows.every((r) => /^required\s/.test(r)), s.out);
        check('...keeping the store profile the source list declares',
            rows.every((r) => /\sstore\s/.test(r)), s.out);
        check('...and naming both halves of the pair',
            rows.some((r) => r.includes('*.aab')) && rows.some((r) => r.includes('*.apk')), s.out);
        check('...and no row from any other lane',
            !/\.dmg|\.exe|\.deb|tar\.gz|\.zip/.test(s.out), s.out);

        // EVERY COLUMN SURVIVES, not the four this function happens to
        // parse. Measured, not theorised: the first implementation rebuilt
        // the row from four fields and dropped the fifth (the signature
        // class), so a scoped release reached verify-signatures.mjs with
        // both artifacts declaring no class at all - found by running the
        // real sign.sh, not by reading the diff. Compared against the
        // SOURCE row's own width, so the day a sixth column is added this
        // assertion is already testing it.
        const sourceRows = readFileSync(expected, 'utf8').split('\n')
            .filter((l) => /^(required|optional)\s/.test(l));
        const widths = new Set(sourceRows.map((l) => l.trim().split(/\s+/).length));
        check('the source list has one consistent column count',
            widths.size === 1, [...widths].join(','));
        check('...and every scoped row carries all of them',
            rows.every((r) => r.trim().split(/\s+/).length === [...widths][0]),
            `source=${[...widths][0]} scoped=${rows.map((r) => r.trim().split(/\s+/).length)}`);

        // The android rows' fifth column specifically, by value: this is
        // what verify-signatures.mjs reads, and `deferred-android` is the
        // class that says the ceremony verified the signature itself.
        const androidSource = sourceRows.filter((l) => /android-v\*\.aab|wallet-v\*\.apk/.test(l));
        check('...preserving the signature class verbatim',
            androidSource.length === 2 && androidSource.every((src) => {
                const cols = src.trim().split(/\s+/);
                return rows.some((r) => r.trim().split(/\s+/).slice(1).join(' ')
                    === cols.slice(1).join(' '));
            }), `${androidSource.join(' | ')}\n${rows.join(' | ')}`);
    }

    // 2. THE ROW-81 FAILURE, fixed. An Android-only directory passed
    //    through the scoped list is a clean release.
    {
        const s = scope(['android']);
        const r = gate(stage([AAB, APK]), s.path);
        check('an android-only staging dir passes the artifact-set gate under scope',
            r.ok && /artifact-set gate ok/.test(r.out), r.out);
    }

    // 3. The same directory against the FULL list still fails, so nothing
    //    was weakened for the default path. This is the measurement that
    //    proves the mode is opt-in rather than a loosening.
    {
        const r = gate(stage([AAB, APK]), expected);
        check('the unscoped gate still refuses an android-only release',
            !r.ok && /artifact-set gate FAILED/.test(r.out), r.out);
        check('...naming the desktop rows it is missing',
            /MISSING\s+no artifact matches required pattern: \*\.dmg/.test(r.out), r.out);
    }

    // 4. The teeth. An artifact belonging to another lane, staged into a
    //    scoped directory, is undeclared - a per-lane manifest must not
    //    become a place to launder a stray file.
    {
        const s = scope(['android']);
        const r = gate(stage([AAB, APK, WEB]), s.path);
        check('an out-of-scope artifact is UNDECLARED under scope, not tolerated',
            !r.ok && /UNDECLARED/.test(r.out) && r.out.includes(WEB), r.out);
    }

    // 5. A lane is not optional to itself. The Android pair is ONE build
    //    (the APK is derived from the AAB), so half of it is an
    //    interrupted ceremony, never a smaller release.
    {
        const s = scope(['android']);
        const r = gate(stage([AAB]), s.path);
        check('the AAB alone fails under scope: the direct APK is required',
            !r.ok && /MISSING.*\*\.apk/.test(r.out), r.out);
    }

    // 6. A lane name is not free text. A typo must fail here rather than
    //    resolve to an empty scope, which would demand nothing at all.
    {
        const s = scope(['andriod']);
        check('an undeclared lane name is refused', !s.ok, s.out);
        check('...and the message lists the lanes that do exist',
            /not a lane declared in/.test(s.out) && /android/.test(s.out), s.out);
    }

    // 7. Drift, the same direction shipped-lanes.txt already guards: a
    //    lane claiming a glob no release row declares would put the two
    //    files on different releases.
    {
        const bad = join(work, 'lanes-drift.txt');
        writeFileSync(bad, 'android   NOT-SHIPPED   xchain-wallet-v*.sideload\n');
        const s = scope(['android'], { lanesPath: bad });
        check('a lane glob no expected-artifacts row declares is refused',
            !s.ok && /declares/.test(s.out), s.out);
    }

    // 8. The signed header. A partial manifest that did not SAY it was
    //    partial would be the defect this mode is meant to avoid: a
    //    perfectly verifying record read as evidence about a release it
    //    never covered.
    {
        const dir = stage([AAB, APK]);
        const s = scope(['android']);
        const r = sh(`xr_write_manifest ${JSON.stringify(dir)} v${V} abc123 `
            + `2026-08-06T07:00:00Z enforced ${JSON.stringify(s.path)} android 2>&1`);
        check('a scoped manifest writes', r.ok, r.out);
        const text = readFileSync(join(dir, 'RELEASE_HASHES.txt'), 'utf8');
        check('...declaring partial coverage', /^# coverage: partial$/m.test(text), text);
        check('...and naming the lanes it covers', /^# lanes: android$/m.test(text), text);
        check('...while still carrying the version-2 profile lines',
            /^# profile store: \.\/xchain-wallet-android/m.test(text), text);
    }

    // 9. And the converse: a full release manifest carries neither field,
    //    so "partial" is something a manifest says, never something a
    //    reader has to infer from what is absent.
    {
        const dir = stage([AAB, APK]);
        const s = scope(['android']);
        const r = sh(`xr_write_manifest ${JSON.stringify(dir)} v${V} abc123 `
            + `2026-08-06T07:00:00Z enforced ${JSON.stringify(s.path)} 2>&1`);
        check('an unscoped manifest writes', r.ok, r.out);
        const text = readFileSync(join(dir, 'RELEASE_HASHES.txt'), 'utf8');
        check('...and says nothing about coverage or lanes',
            !/^# coverage:/m.test(text) && !/^# lanes:/m.test(text), text);
    }

    // 10. The shipped-lane gate under a scope. Its parity requirement is
    //     about lanes that already have users, and a partial release
    //     legitimately omits the lanes it is not covering - but only the
    //     ones it is not covering.
    {
        const lanesShipped = join(work, 'lanes-shipped.txt');
        writeFileSync(lanesShipped, [
            'android   SHIPPED       xchain-wallet-android-v*.aab xchain-wallet-v*.apk',
            'ios       SHIPPED       xchain-wallet-ios-v*.ipa',
            'mas       NOT-SHIPPED   *-mas.pkg',
            'msstore   NOT-SHIPPED   *-appx.appx',
            'snap      NOT-SHIPPED   *.snap',
            '',
        ].join('\n'));
        const dir = stage([AAB, APK]);
        const scoped = sh(`xr_check_shipped_lanes ${JSON.stringify(dir)} `
            + `${JSON.stringify(lanesShipped)} ${JSON.stringify(expected)} android 2>&1`);
        check('a scoped shipped-lane gate ignores a SHIPPED lane outside the scope',
            scoped.ok && /shipped-lane gate ok/.test(scoped.out), scoped.out);
        check('...and says out loud which lanes it did not check',
            /scope/.test(scoped.out), scoped.out);

        const unscoped = sh(`xr_check_shipped_lanes ${JSON.stringify(dir)} `
            + `${JSON.stringify(lanesShipped)} ${JSON.stringify(expected)} 2>&1`);
        check('...while the unscoped gate still fails on the missing iOS lane',
            !unscoped.ok && /LANE-REGRESSION/.test(unscoped.out) && /ipa/.test(unscoped.out),
            unscoped.out);

        const halfPair = sh(`xr_check_shipped_lanes ${JSON.stringify(stage([AAB]))} `
            + `${JSON.stringify(lanesShipped)} ${JSON.stringify(expected)} android 2>&1`);
        check('...and a regression INSIDE the scope still fails',
            !halfPair.ok && /LANE-REGRESSION/.test(halfPair.out) && /apk/.test(halfPair.out),
            halfPair.out);
    }

    // 11. sign.sh must actually wire it. A mode reachable only from a
    //     library function is prose: the ceremony's closing line runs
    //     sign.sh.
    {
        const sign = readFileSync(join(repo, 'tools', 'release', 'sign.sh'), 'utf8');
        check('sign.sh accepts --lane', /^\s*--lane\|-l\)/m.test(sign), 'no --lane branch');
        check('...derives the scope through xr_lane_scope',
            /xr_lane_scope/.test(sign), 'xr_lane_scope not called');
        check('...gates the artifact set against the SCOPED list',
            /xr_check_expected "\$INPUT_DIR" "\$GATE_EXPECTED"/.test(sign), 'wrong list');
        check('...checks signatures against the scoped list too',
            /verify-signatures\.mjs" "\$INPUT_DIR" "\$GATE_EXPECTED"/.test(sign), 'wrong list');
        check('...passes the FULL list to the shipped-lane gate, whose drift'
            + ' checks are about the two committed files rather than this release',
            /xr_check_shipped_lanes "\$INPUT_DIR" "\$LANES" "\$EXPECTED"/.test(sign), 'wrong list');
        check('...and writes the coverage into the manifest',
            /xr_write_manifest "\$INPUT_DIR"[\s\S]{0,200}?"\$COVERAGE_LANES"/.test(sign),
            'coverage not written');
        check('...and its usage block documents the flag, since the runbook'
            + ' is generated from nothing but this text',
            /--lane/.test(sign.slice(0, sign.indexOf('set -euo pipefail'))), 'undocumented');
    }

    // 12. verify.sh is the reader an operator and a user actually run. A
    //     partial manifest must announce itself there, or "my artifact is
    //     not in the manifest" reads as a tampering alarm instead of the
    //     truth, which is that this manifest was never about that lane.
    {
        const verify = readFileSync(join(repo, 'tools', 'release', 'verify.sh'), 'utf8');
        check('verify.sh reads the lanes field',
            /xr_header_field "\$MANIFEST" 'lanes'/.test(verify), 'not read');
        check('...and reports partial coverage', /PARTIAL/.test(verify), 'not reported');
    }

    // 13. The desktop updater is the third reader, and the only automated
    //     one. It must refuse a partial manifest by name rather than fall
    //     through to "not covered by the signed manifest", which reads as
    //     a tampered release.
    //
    //     WIRING ONLY. This grep cannot tell the guard from its own error
    //     string - measured, by disarming the guard and watching this pass
    //     - so the check that actually bites is behavioural and lives in
    //     test/unit/desktop/updateVerify.test.js ("refuses a PARTIAL
    //     manifest"). Kept here so a reader of this file is sent there.
    {
        const upd = readFileSync(join(repo, 'packages', 'desktop', 'main', 'updateVerify.js'), 'utf8');
        check('the desktop updater refuses a partial manifest',
            /header\.lanes|header\['lanes'\]/.test(upd), 'partial coverage not checked');
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
    console.error(`\n${failures} lane-scope check(s) failed.`);
    process.exit(1);
}

assert.ok(true);
console.log(
    'OK: release lane-scope smoke ( / : sign.sh --lane derives a'
    + ' partial-release scope from shipped-lanes.txt, so a lane whose artifacts'
    + ' are ready can be signed and published without the other lanes being'
    + ' built - and the artifact-set gate keeps every tooth it had: inside the'
    + ' scope both halves of the Android pair are REQUIRED rather than optional,'
    + ' an artifact from any other lane is UNDECLARED, an undeclared lane name'
    + ' is refused instead of narrowing the release to nothing, the unscoped'
    + ' path still fails an android-only directory, and the manifest declares'
    + ' `coverage: partial` with the lanes it covers so verify.sh, an operator'
    + ' and the desktop updater all know what it does not attest)',
);
