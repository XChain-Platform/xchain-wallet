// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/verify-apk-play-protection.mjs, shown both artifacts.
//
// The tool exists because Play's `Prevent unofficial installs` turned out to
// be code Google injects into the artifact IT signs, not a device-side rule
// (, measured 2026-08-13 by diffing the published K10 direct APK
// against the console's universal APK for the same version code, and by
// sideloading both onto a Play-enabled emulator). The direct lane is therefore
// safe only while the bytes it publishes are the ceremony's own, and the way
// that stops being true is a console download copied into the publish set.
//
// NEITHER REAL ARTIFACT IS IN THE REPO - a 5 MB signed binary does not belong
// in a test tree - so the fixtures here are synthetic APKs built from the
// tool's OWN marker table. That direction matters: a marker added to the tool
// without being exercised here would make the per-marker section fail on the
// spot rather than pass silently, and a fixture typed by hand beside the table
// would only prove that last month's markers still match.
//
// The zip writer (test/smoke/_apk.js, shared with the publish-path smoke) is
// deliberate too. The tool reads APKs with its own central directory parser
// (no dependency, no bundletool for the operator to install), and a parser is
// exactly the thing that passes on the one file it was written against: these
// fixtures give it a stored entry and a deflated one, entries whose local
// headers carry extra fields the central directory does not, and a marker
// string split across the two encodings a binary manifest uses.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildZip, dexBody, manifestBody } from '../_apk.js';
import {
    EXIT, MARKERS, judge, main, parseArgs, scanApk,
} from '../../../tools/release/verify-apk-play-protection.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const TOOL = join(root, 'tools/release/verify-apk-play-protection.mjs');

// --- the contract, read rather than restated ---------------------------
assert.equal(MARKERS.length, 5,
    `the tool declares ${MARKERS.length} markers, not the five this file was written against. `
    + 'If Play\'s injection grew or shrank a component, extend the fixtures below in the same '
    + 'change; the per-marker section is what would otherwise pass while checking less.');

for (const m of MARKERS) {
    assert.ok(['dex', 'manifest', 'entry'].includes(m.where),
        `marker ${m.id} claims to live in "${m.where}", which the scanner has no reader for`);
    assert.ok(m.needle && m.why, `marker ${m.id} is missing its needle or its explanation`);
}

const dir = mkdtempSync(join(tmpdir(), 'apk-play-protection-'));
const write = (name, files) => {
    const p = join(dir, name);
    writeFileSync(p, buildZip(files));
    return p;
};

const CLEAN_FILES = [
    { name: 'AndroidManifest.xml', body: manifestBody(), store: true },
    { name: 'classes.dex', body: dexBody(), extra: 12 },
    { name: 'resources.arsc', body: Buffer.from('arsc'), store: true },
    { name: 'META-INF/XCHAIN-D.RSA', body: Buffer.from('signature'), extra: 4 },
];

const needle = (id) => MARKERS.find((m) => m.id === id).needle;

try {
    // --- 1. the ceremony's artifact: no marker, and the verdict is clean ---
    const clean = write('direct.apk', CLEAN_FILES);
    const cleanScan = scanApk(clean);
    assert.deepEqual(cleanScan.found, [],
        `a K10-shaped APK reported Play markers ${cleanScan.found.join(', ')}. The scanner is `
        + 'matching something the ceremony\'s own build contains, so every direct publish would '
        + 'fail this gate and the gate would be turned off.');
    assert.equal(cleanScan.scanned.dex, 1, 'the dex was not scanned at all, so "none found" means nothing');
    assert.equal(judge(cleanScan.found, 'absent').code, EXIT.OK);

    // --- 2. Google's artifact: every marker, in its own place -------------
    //
    // Built from the marker table so the fixture cannot fall behind it.
    const injectedFiles = [
        {
            name: 'AndroidManifest.xml',
            body: manifestBody(MARKERS.filter((m) => m.where === 'manifest').map((m) => m.needle)),
            store: true,
        },
        {
            name: 'classes.dex',
            body: dexBody(MARKERS.filter((m) => m.where === 'dex')
                .map((m) => `${m.needle}licensecheck/LicenseClient;`)),
            extra: 12,
        },
        ...CLEAN_FILES.filter((f) => !/^(AndroidManifest\.xml|classes\.dex)$/.test(f.name)),
        ...MARKERS.filter((m) => m.where === 'entry')
            .map((m) => ({ name: m.needle, body: Buffer.from('0123456789abcdef'), store: true })),
    ];
    const injected = write('play.apk', injectedFiles);
    const injectedScan = scanApk(injected);
    assert.deepEqual(injectedScan.found.sort(), MARKERS.map((m) => m.id).sort(),
        `the Play-shaped fixture matched ${injectedScan.found.length} of ${MARKERS.length} markers. `
        + 'A scanner that sees some of the injection and not the rest would pass an artifact whose '
        + 'licence check still runs.');

    const violation = judge(injectedScan.found, 'absent');
    assert.equal(violation.code, EXIT.VIOLATION);
    assert.match(violation.errors.join('\n'), /android-ceremony\.sh/,
        'the failure does not name the ceremony script. An operator reading this at publish time '
        + 'needs the recovery step, not only the diagnosis.');

    // --- 3. each marker alone -------------------------------------------
    //
    // Five markers checked together are indistinguishable from one marker
    // checked five times, and the injection can arrive incomplete: a manifest
    // edit that strips the activity leaves the pairip classes in the dex.
    for (const marker of MARKERS) {
        const only = write(`only-${marker.id}.apk`, [
            {
                name: 'AndroidManifest.xml',
                body: manifestBody(marker.where === 'manifest' ? [marker.needle] : []),
                store: true,
            },
            {
                name: 'classes.dex',
                body: dexBody(marker.where === 'dex' ? [`${marker.needle}x/Y;`] : []),
                extra: 12,
            },
            ...(marker.where === 'entry'
                ? [{ name: marker.needle, body: Buffer.from('stamp'), store: true }]
                : []),
        ]);
        assert.deepEqual(scanApk(only).found, [marker.id],
            `an APK carrying only ${marker.id} scanned as ${scanApk(only).found.join(', ') || 'clean'}. `
            + 'Either that marker is not being looked for, or another one false-positives on a '
            + 'fixture that does not contain it.');
    }

    // --- 4. --expect present, so the check is shown to be falsifiable ----
    assert.equal(judge(injectedScan.found, 'present').code, EXIT.OK);
    const missed = judge([], 'present');
    assert.equal(missed.code, EXIT.VIOLATION,
        'a clean artifact passed --expect present. That direction is how an operator confirms the '
        + 'console toggle is still on; a check that cannot fail there proves nothing when it passes.');

    // --- 5. what the tool does when it cannot judge ----------------------
    //
    // "Not an APK" must never round to "clean". A jar of the wrong shape, a
    // truncated download, an .aab handed over by mistake: each is a config
    // failure the operator has to see, and each would otherwise be the
    // cheapest possible green.
    const notAnApk = write('empty.apk', [{ name: 'README', body: Buffer.from('hi'), store: true }]);
    assert.throws(() => scanApk(notAnApk), /classes\.dex/,
        'an archive with no dex was scanned rather than refused, so a truncated or wrong-format '
        + 'download would report "no Play protection found" and pass the publish gate.');

    const truncated = join(dir, 'truncated.apk');
    writeFileSync(truncated, Buffer.from('not a zip at all'));
    assert.throws(() => scanApk(truncated), /zip/i);

    // --- 6. the CLI surface ---------------------------------------------
    const capture = () => {
        const out = [];
        const sink = { write: (s) => { out.push(s); return true; } };
        return { out, sink };
    };

    const okRun = capture();
    assert.equal(main([clean], okRun.sink, okRun.sink), EXIT.OK);
    assert.match(okRun.out.join(''), /found:\s+none/);

    const badRun = capture();
    assert.equal(main([injected], badRun.sink, badRun.sink), EXIT.VIOLATION,
        'the default expectation is not "absent". The direct lane is the common caller, and a '
        + 'default that has to be spelled out is a flag somebody forgets in the ceremony.');

    const noArg = capture();
    assert.equal(main([], noArg.sink, noArg.sink), EXIT.CONFIG);
    const badFlag = capture();
    assert.equal(main([clean, '--expect', 'maybe'], badFlag.sink, badFlag.sink), EXIT.CONFIG,
        '--expect took a value it does not understand instead of refusing it, so a typo would '
        + 'silently fall back to the default expectation.');
    assert.equal(parseArgs(['x.apk']).expect, 'absent');

    const help = execFileSync('node', [TOOL, '--help'], { encoding: 'utf8' });
    assert.match(help, /^usage:/m);
    for (const m of MARKERS) {
        assert.ok(help.includes(m.id),
            `--help does not name marker ${m.id}. The operator reading a failure needs to see what `
            + 'the tool looks for without opening it.');
    }
} finally {
    rmSync(dir, { recursive: true, force: true });
}

console.log('apk-play-protection smoke OK');
