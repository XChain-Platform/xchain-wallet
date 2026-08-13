// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/verify-apk-play-protection.mjs - says whether an APK carries
// Google Play's injected anti-tamper ("Prevent unofficial installs"), and
// holds the direct-download lane to carrying NONE of it.
//
// WHAT PLAY'S TOGGLE ACTUALLY IS, MEASURED RATHER THAN REASONED ABOUT
// (2026-08-13, ; the artefacts compared were the published direct APK
// xchain-wallet-v0.336.0.apk and the console's universal APK 3360050.apk for
// the same version code):
//
//   - `Prevent unofficial installs` is not a device-side setting and not a
//     Play Protect rule. It is CODE GOOGLE INJECTS into the artifact it signs.
//     The console APK carries `com.pairip.application.Application` as its
//     application class, a `com.pairip.licensecheck.LicenseActivity`, the
//     `com.android.vending.CHECK_LICENSE` permission, and a `stamp-cert-sha256`
//     source stamp. The K10-signed direct APK carries none of the four, and
//     the class diff is purely additive: 5414 classes against 5383, with
//     nothing present in the direct artifact that is missing from Play's.
//   - Sideloaded onto the same Play-enabled emulator, the difference shows:
//     the console artifact logs `LicenseClient: Local install check failed due
//     to wrong installer`, starts LicenseActivity, dies, and leaves Google
//     Play in front of the user; the direct APK reaches the wallet's own terms
//     screen and stays there.
//
// So the direct lane is safe for exactly one reason, and it is a property of
// the BYTES rather than of an argument: the ceremony's artifact never passes
// through Google's signing pipeline, so nothing injects the check into it.
//
// WHICH IS WHY THIS IS A GATE AND NOT A NOTE IN THE SPEC. The reasoning stops
// holding the moment a Play-derived artifact reaches downloads.xchain.io - a
// console "download signed APK" copied into the publish set to save a ceremony
// run would do it - and the symptom is not a build failure. It is every direct
// installer being bounced to the Play Store on first launch, discovered by the
// users the sovereign lane exists for. That artifact passes the signature
// checks too: it is validly signed, just by Google.
//
// The check reads the APK itself rather than a manifest dump, because the two
// halves of the evidence live in different places (the manifest names the
// injected components, the dex holds their code) and because a tool an
// operator runs mid-ceremony should not owe them a bundletool install first.

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export const EXIT = { OK: 0, VIOLATION: 1, CONFIG: 2 };

// The four markers, each a distinct piece of the injection, so a partial
// match still reads as a finding rather than rounding to "clean". They are
// searched in the entries where they actually live: dex code for the classes,
// the binary manifest for the declarations, the zip directory for the stamp.
export const MARKERS = [
    {
        id: 'pairip-classes',
        where: 'dex',
        needle: 'Lcom/pairip/',
        why: 'Play\'s injected anti-tamper/licence-check classes (com.pairip.*)',
    },
    {
        id: 'pairip-application',
        where: 'manifest',
        needle: 'com.pairip.application.Application',
        why: 'the application class Play substitutes for the app\'s own',
    },
    {
        id: 'licensecheck-activity',
        where: 'manifest',
        needle: 'com.pairip.licensecheck.LicenseActivity',
        why: 'the activity that fronts the "get this app from Google Play" bounce',
    },
    {
        id: 'check-license-permission',
        where: 'manifest',
        needle: 'com.android.vending.CHECK_LICENSE',
        why: 'the permission the injected check needs to reach the licensing service',
    },
    {
        id: 'source-stamp',
        where: 'entry',
        needle: 'stamp-cert-sha256',
        why: 'Play\'s source stamp, present only on an artifact Google produced',
    },
];

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;

/**
 * Minimal zip reader: central directory only, no zip64, no encryption. An APK
 * this tool is pointed at is a few megabytes with a few hundred entries, so
 * the whole file is read into memory and the entries of interest inflated on
 * demand. Deliberately not a dependency: the release tree stays installable
 * from a checkout with no registry reachable.
 */
export function readZip(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i -= 1) {
        if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('not a zip archive: no end-of-central-directory record');

    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const entries = [];
    for (let i = 0; i < count; i += 1) {
        if (buf.readUInt32LE(p) !== CD_SIG) throw new Error(`central directory entry ${i} is malformed`);
        const method = buf.readUInt16LE(p + 10);
        const compressedSize = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const localOffset = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        entries.push({ name, method, compressedSize, localOffset });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

export function readEntry(buf, entry) {
    // The local header repeats the name and extra fields with its OWN lengths;
    // reading the central directory's extra length here is a classic way to
    // land a few bytes into the data and inflate garbage.
    const lh = entry.localOffset;
    const nameLen = buf.readUInt16LE(lh + 26);
    const extraLen = buf.readUInt16LE(lh + 28);
    const start = lh + 30 + nameLen + extraLen;
    const raw = buf.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return inflateRawSync(raw);
    throw new Error(`${entry.name}: unsupported compression method ${entry.method}`);
}

// The binary manifest stores its string pool as UTF-16LE (and, for short
// ASCII strings, sometimes UTF-8), so a single-encoding search reports a
// clean manifest on an injected one.
const contains = (buf, needle) => buf.includes(Buffer.from(needle, 'latin1'))
    || buf.includes(Buffer.from(needle, 'utf16le'));

/**
 * @returns {{found: string[], scanned: {dex: number, manifest: boolean}}}
 */
export function scanApk(path) {
    const buf = readFileSync(path);
    const entries = readZip(buf);
    const dex = entries.filter((e) => /^classes\d*\.dex$/.test(e.name));
    const manifest = entries.find((e) => e.name === 'AndroidManifest.xml');

    if (dex.length === 0) {
        throw new Error(`${path} holds no classes.dex, so it is not an APK this check can judge`);
    }
    if (!manifest) {
        throw new Error(`${path} holds no AndroidManifest.xml, so it is not an APK this check can judge`);
    }

    const bodies = {
        dex: dex.map((e) => readEntry(buf, e)),
        manifest: [readEntry(buf, manifest)],
    };
    const names = new Set(entries.map((e) => e.name));

    const found = [];
    for (const marker of MARKERS) {
        const hit = marker.where === 'entry'
            ? names.has(marker.needle)
            : bodies[marker.where].some((b) => contains(b, marker.needle));
        if (hit) found.push(marker.id);
    }
    return { found, scanned: { dex: dex.length, manifest: true } };
}

/**
 * @param {string[]} found  marker ids from scanApk
 * @param {'absent'|'present'} expect
 */
export function judge(found, expect) {
    const describe = (id) => {
        const m = MARKERS.find((x) => x.id === id);
        return `  - ${id}: ${m.why}`;
    };
    if (expect === 'absent' && found.length > 0) {
        return {
            code: EXIT.VIOLATION,
            lines: [],
            errors: [
                'PLAY PROTECTION FOUND IN A DIRECT-LANE ARTIFACT.',
                ...found.map(describe),
                '',
                'This APK went through Google\'s signing pipeline; the direct-download lane must',
                'publish the ceremony\'s own K10-signed build. Shipping this one bounces every',
                'direct installer to the Play Store on first launch (measured 2026-08-13: the',
                'injected check logs "Local install check failed due to wrong installer", starts',
                'LicenseActivity, and kills the app). Re-run tools/release/android-ceremony.sh and',
                'publish what IT produced.',
            ],
        };
    }
    if (expect === 'present' && found.length === 0) {
        return {
            code: EXIT.VIOLATION,
            lines: [],
            errors: [
                'NO PLAY PROTECTION FOUND, and --expect present says there should be.',
                'Either this is not the artifact Google signed, or Play\'s automatic protection was',
                'turned off for this app - which is a console-state change worth confirming.',
            ],
        };
    }
    return {
        code: EXIT.OK,
        lines: expect === 'absent'
            ? ['clean: no Play-injected licence check, no source stamp (direct lane, as required)']
            : [`play-signed: ${found.length} of ${MARKERS.length} protection markers present`],
        errors: [],
    };
}

export const USAGE = `usage: verify-apk-play-protection.mjs <app.apk> [--expect absent|present]

Says whether an APK carries Google Play's injected "Prevent unofficial
installs" anti-tamper, and fails if that does not match what is expected.

  --expect absent   (default) the direct-download lane: the artifact must be
                    the ceremony's own K10-signed build, carrying none of
                    Play's injected licence check
  --expect present  the artifact Google signed: assert the injection IS there,
                    which is how the check itself is shown to be sensitive

Markers, all read out of the APK itself with no external toolchain:
${MARKERS.map((m) => `  ${m.id.padEnd(26)} ${m.why}`).join('\n')}

Exit: 0 as expected · 1 mismatch · 2 bad usage or unreadable APK`;

export function parseArgs(argv) {
    const out = { help: false, path: null, expect: 'absent', unknown: null };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--help' || a === '-h') out.help = true;
        else if (a === '--expect') {
            const v = argv[i + 1];
            i += 1;
            if (v !== 'absent' && v !== 'present') { out.unknown = `--expect ${v ?? '(missing)'}`; break; }
            out.expect = v;
        } else if (a.startsWith('-')) { out.unknown = a; break; } else if (out.path === null) out.path = a;
        else { out.unknown = a; break; }
    }
    return out;
}

export function main(argv = process.argv.slice(2), out = process.stdout, err = process.stderr) {
    const args = parseArgs(argv);
    if (args.help) { out.write(`${USAGE}\n`); return EXIT.OK; }
    if (args.unknown) { err.write(`unknown argument: ${args.unknown}\n${USAGE}\n`); return EXIT.CONFIG; }
    if (!args.path) { err.write(`no APK given\n${USAGE}\n`); return EXIT.CONFIG; }

    let scan;
    try {
        scan = scanApk(args.path);
    } catch (e) {
        err.write(`cannot read ${args.path}: ${e.message}\n`);
        return EXIT.CONFIG;
    }

    const verdict = judge(scan.found, args.expect);
    out.write(`apk:    ${args.path}\n`);
    out.write(`dex:    ${scan.scanned.dex} file(s) scanned\n`);
    out.write(`found:  ${scan.found.length ? scan.found.join(', ') : 'none'}\n`);
    if (verdict.lines.length) out.write(`${verdict.lines.join('\n')}\n`);
    if (verdict.errors.length) err.write(`${verdict.errors.join('\n')}\n`);
    return verdict.code;
}

if (process.argv[1] && process.argv[1].endsWith('verify-apk-play-protection.mjs')) {
    process.exitCode = main();
}
