#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/verify-signatures.mjs - does each staged artifact actually
// carry the OS code signature its row says it should? (, the goal
// sentence: "every desktop user ... can install a SIGNED build".)
//
// WHY THIS EXISTS, AND IT IS NOT HYPOTHETICAL. Windows signing is selected
// in electron-builder.config.cjs off three environment variables:
//
//     const azureSigning
//         = process.env.AZURE_CODE_SIGNING_ENDPOINT
//             && process.env.AZURE_CODE_SIGNING_NAME
//             && process.env.AZURE_CERT_PROFILE_NAME
//             ? { ... } : null;
//
// and that file says in as many words what happens when they are absent:
// "with no Azure vars set it is entirely inert ... still produces unsigned
// artifacts". macOS behaves the same way - electron-builder skips signing
// and prints a warning rather than failing. So ONE missing or mistyped
// repository secret produces a complete, correctly-named, correctly-sized,
// two-architecture set of UNSIGNED installers.
//
// Nothing downstream noticed. `xr_check_expected` counts artifacts and
// architectures; `sign.sh` then hashes them into a K1-signed manifest, and
// K1 attests the BYTES, not the publisher - a manifest over unsigned
// installers verifies perfectly. This is the same defect family as the
// arch gate before  ("declared classes and never counted") and
// row 32's floor of 0: a gate that never asks a question cannot fail it.
//
// THE COST OF SHIPPING ONE UNSIGNED RELEASE IS NOT ONE BAD RELEASE.
//   - Every install shows the "unknown developer" warning that 
//     records as an explicit operator requirement not to have.
//   - electron-updater refuses an update whose signed publisher does not
//     match the installed app's publisher. `WIN_PUBLISHER` is described in
//     the config as "effectively a wire format". An unsigned release
//     therefore does not merely look wrong, it can strand the fleet that
//     already installed a signed one, and the fix is a migration.
//
// WHAT THIS CHECKS, AND WHAT IT DELIBERATELY DOES NOT. It checks that a
// signature is PRESENT. It does not validate the certificate chain, the
// timestamp, or the publisher name, and it is not an adversarial control -
// against a hostile build host the answer is K1's manifest, not this. The
// failure it is built for is our own: a release cut with a secret missing.
// Presence is exactly the property that distinguishes that case, and it is
// checkable on any host, which matters because the gate must run on the
// same Linux runner that assembles the release rather than only on the
// macOS and Windows lanes that produced the artifacts.
//
// EVERY CLASS IS DECLARED, INCLUDING THE ONES NOT VERIFIED, and the report
// separates them. A class this tool cannot check reads as `recorded`, never
// as `ok`, because "we did not look" and "we looked and it was fine" being
// indistinguishable is the precise hole this whole file is a response to.

import { readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * The signature classes an artifact row may declare, and what this tool
 * does about each. `verify: true` means a failure here fails the release.
 */
export const SIGNATURE_CLASSES = {
    // We sign it, on our lane, and a missing secret silently skips it.
    // These are the two the gate exists for.
    authenticode: {
        verify: true,
        what: 'Windows Authenticode signature embedded in the PE certificate table',
    },
    codesign: {
        verify: true,
        what: 'Apple code signature (a sealed _CodeSignature/CodeResources inside the .app)',
    },
    // Genuinely unsigned by design. Linux has no OS signature for a
    // generic binary; the web tarball and extension zip are not OS
    // artifacts at all. Their integrity story is the K1 manifest, which
    // is stated on the Linux docs page rather than implied here.
    none: {
        verify: false,
        what: 'no OS code signature by design; integrity rides the K1 manifest',
    },
    // A store signs it after upload, so what we stage is legitimately
    // unsigned and what users install is signed by somebody else. We
    // cannot check that here and must not pretend the absence is a fault.
    store: {
        verify: false,
        what: 'signed by the receiving store after upload, not by us',
    },
    // Signed by us, on another shell's lane, with tooling this spec does
    // not own (apksigner). Declared so the row is not silently `none`.
    'deferred-android': {
        verify: false,
        what: 'APK/AAB signing is \'s lane (apksigner); declared here, checked there',
    },
    // Signed by us and NOT checkable from a Linux runner: a .dmg is a
    // disk image, and reading its signature needs macOS `codesign`. The
    // mac zip beside it carries the same app bundle and IS checked, so
    // the lane is not unguarded - but this row is an honest gap with a
    // name rather than an omission.
    'codesign-unverified': {
        verify: false,
        what: 'Apple-signed disk image; needs macOS codesign, not checkable from a Linux runner',
    },
    // The portable Windows zip. The signed thing is the PE INSIDE the
    // archive, not the archive, so the certificate-table read does not
    // apply to the staged file and declaring it `authenticode` would fail
    // a correctly-signed artifact. The installer built from the same
    // packaged output IS checked, so a lane that skipped signing is still
    // caught - by the .exe row, on the same lane, in the same release.
    'authenticode-unverified': {
        verify: false,
        what: 'the signed executable is inside the archive; the .exe row covers this lane',
    },
};

/**
 * Is this buffer a PE with a non-empty certificate table?
 *
 * Authenticode does not live in a section: it is appended to the file and
 * pointed at by data directory entry 4 (IMAGE_DIRECTORY_ENTRY_SECURITY) in
 * the optional header. An unsigned PE has that entry zeroed. That makes
 * presence a two-field read once the optional header is located, with no
 * ASN.1 parsing and no dependency.
 *
 * Returns { ok, reason }. Anything that is not a PE at all is a failure
 * rather than a skip: this is only ever called on a row that declared
 * `authenticode`, so a non-PE there means the artifact is not what the
 * declaration says it is.
 */
export function peHasCertificateTable(buf) {
    if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) {
        return { ok: false, reason: 'not a PE file (no MZ header)' };
    }
    const peOff = buf.readUInt32LE(0x3c);
    if (peOff + 24 > buf.length || buf.readUInt32LE(peOff) !== 0x00004550) {
        return { ok: false, reason: 'not a PE file (no PE\\0\\0 signature)' };
    }
    const optOff = peOff + 24;
    if (optOff + 2 > buf.length) return { ok: false, reason: 'truncated optional header' };
    const magic = buf.readUInt16LE(optOff);
    // PE32 (0x10b) puts the data directory at +96; PE32+ (0x20b) at +112.
    // Both arm64 and x64 installers are PE32+, but NSIS stubs have shipped
    // as PE32 before, so both are handled rather than assumed.
    const ddOff = magic === 0x20b ? optOff + 112 : optOff + 96;
    const numRvaOff = magic === 0x20b ? optOff + 108 : optOff + 92;
    if (numRvaOff + 4 > buf.length) return { ok: false, reason: 'truncated optional header' };
    const numRva = buf.readUInt32LE(numRvaOff);
    // Entry 4 is the certificate table. A binary with fewer than five
    // directory entries cannot carry one at all.
    if (numRva < 5) return { ok: false, reason: 'no certificate table (only ' + numRva + ' data directories)' };
    const certOff = ddOff + 4 * 8;
    if (certOff + 8 > buf.length) return { ok: false, reason: 'truncated data directory' };
    const addr = buf.readUInt32LE(certOff);
    const size = buf.readUInt32LE(certOff + 4);
    if (addr === 0 || size === 0) {
        return { ok: false, reason: 'UNSIGNED: certificate table is empty' };
    }
    return { ok: true, reason: `certificate table present (${size} bytes)` };
}

/**
 * Does this zip contain a sealed macOS code signature?
 *
 * A signed .app carries `Contents/_CodeSignature/CodeResources`. Zip entry
 * NAMES are stored uncompressed in both the local header and the central
 * directory whatever the entry's compression method, so presence is a raw
 * byte scan - no zip parsing, no inflate, no dependency.
 *
 * STATED LIMIT: a scan for a name can be satisfied by a file that merely
 * contains those bytes. That is acceptable here for the reason in the
 * header comment - this checks our own build for a skipped signing step,
 * and is not the control against a hostile builder.
 */
export function zipHasCodeSignature(buf) {
    const marker = Buffer.from('_CodeSignature/CodeResources', 'ascii');
    if (buf.includes(marker)) {
        return { ok: true, reason: 'sealed _CodeSignature/CodeResources present' };
    }
    return { ok: false, reason: 'UNSIGNED: no _CodeSignature/CodeResources in the bundle' };
}

/**
 * Check one artifact against one declared signature class.
 * Returns { file, class: cls, state, reason } where state is
 * 'ok' | 'failed' | 'recorded'.
 */
export function checkArtifact(path, cls) {
    const spec = SIGNATURE_CLASSES[cls];
    const file = basename(path);
    if (!spec) {
        return { file, class: cls, state: 'failed', reason: `unknown signature class "${cls}"` };
    }
    if (!spec.verify) {
        return { file, class: cls, state: 'recorded', reason: spec.what };
    }
    let buf;
    try {
        buf = readFileSync(path);
    } catch (err) {
        return { file, class: cls, state: 'failed', reason: `unreadable: ${String(err?.message || err)}` };
    }
    const res = cls === 'authenticode' ? peHasCertificateTable(buf) : zipHasCodeSignature(buf);
    return { file, class: cls, state: res.ok ? 'ok' : 'failed', reason: res.reason };
}

/**
 * Parse the signature column out of expected-artifacts.txt.
 *
 * THE FIFTH COLUMN HAD TO VALIDATE ITSELF, and that is not belt-and-braces.
 * lib.sh reads the row as `status pattern profile arches _rest`, so a fifth
 * column lands in `_rest` and is DISCARDED without comment. A row with a
 * missing or misspelled signature class would therefore parse fine in bash,
 * be skipped silently here, and leave that artifact ungated - which is the
 * identical shape to the defect this whole tool was written for. So the
 * declaration is checked at parse time, before any artifact is looked at,
 * and a row that does not declare a class is a hard failure rather than an
 * unchecked one.
 *
 * Returns { rows: [{ pattern, cls, required }], problems: [string] }.
 */
export function parseExpected(text) {
    const rows = [];
    const problems = [];
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const [status, pattern, profile, arches, cls] = line.split(/\s+/);
        if (status !== 'required' && status !== 'optional') continue;
        if (!cls) {
            problems.push(`'${pattern}' declares no signature class (5th column).`
                + ' Use one of: ' + Object.keys(SIGNATURE_CLASSES).join(', '));
            continue;
        }
        if (!SIGNATURE_CLASSES[cls]) {
            problems.push(`'${pattern}' declares unknown signature class '${cls}'.`
                + ' Expected one of: ' + Object.keys(SIGNATURE_CLASSES).join(', '));
            continue;
        }
        rows.push({ pattern, cls, required: status === 'required', profile, arches });
    }
    if (!rows.length && !problems.length) {
        problems.push('no artifact rows found; the declaration is empty');
    }
    return { rows, problems };
}

/** Glob match on a basename, same shape as the shell gate's patterns. */
export function globMatch(pattern, name) {
    const rx = new RegExp('^' + pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') + '$');
    return rx.test(name);
}

/**
 * Summarise a set of results for the release log.
 *
 * The counts are printed separately on purpose. A release that verified
 * nothing and recorded everything must not read the same as one that
 * checked and passed, which is the failure this tool was written against.
 */
export function summarise(results) {
    const ok = results.filter((r) => r.state === 'ok');
    const failed = results.filter((r) => r.state === 'failed');
    const recorded = results.filter((r) => r.state === 'recorded');
    return { ok: ok.length, failed: failed.length, recorded: recorded.length, failures: failed };
}

/**
 * Check every artifact in `dir` against the declaration in `expectedPath`.
 * Returns an exit code; prints a report shaped like the other release gates.
 */
export function run(dir, expectedPath) {
    let text;
    try {
        text = readFileSync(expectedPath, 'utf8');
    } catch (err) {
        process.stderr.write(`verify-signatures: cannot read ${expectedPath}: ${String(err?.message || err)}\n`);
        return 1;
    }
    const { rows, problems } = parseExpected(text);
    if (problems.length) {
        process.stderr.write('verify-signatures: the artifact declaration is not usable.\n');
        for (const p of problems) process.stderr.write(`  - ${p}\n`);
        process.stderr.write('  A row with no signature class is an UNGATED artifact: lib.sh\n'
            + '  discards the column silently, so nothing else will notice.\n');
        return 1;
    }

    let names;
    try {
        names = readdirSync(dir, { withFileTypes: true })
            .filter((d) => d.isFile()).map((d) => d.name);
    } catch (err) {
        process.stderr.write(`verify-signatures: cannot list ${dir}: ${String(err?.message || err)}\n`);
        return 1;
    }

    const results = [];
    const undeclared = [];
    for (const name of names) {
        const row = rows.find((r) => globMatch(r.pattern, name));
        // An undeclared file is the artifact-set gate's job to refuse, not
        // this one's; it is reported rather than judged, so the two gates
        // do not disagree about the same file.
        if (!row) { undeclared.push(name); continue; }
        results.push(checkArtifact(`${dir}/${name}`, row.cls));
    }

    const sum = summarise(results);
    for (const r of results.filter((x) => x.state !== 'ok')) {
        const mark = r.state === 'failed' ? '✗' : '·';
        process.stdout.write(`${mark} ${r.file}: ${r.reason}\n`);
    }
    if (sum.failed) {
        process.stderr.write(`\nverify-signatures: ${sum.failed} artifact(s) are NOT signed.\n`
            + '  The release must not be manifest-signed in this state: K1 attests the\n'
            + '  bytes, not the publisher, so a manifest over unsigned installers\n'
            + '  verifies perfectly and still ships an unsigned wallet.\n'
            + '  The usual cause is a missing signing secret on the lane that built\n'
            + '  them; the build config skips signing silently when its variables\n'
            + '  are unset.\n');
        return 1;
    }
    process.stdout.write(`signature gate ok (${sum.ok} verified, ${sum.recorded} recorded-not-verified`
        + `${undeclared.length ? `, ${undeclared.length} undeclared left to the artifact-set gate` : ''})\n`);
    return 0;
}

const invokedDirectly = process.argv[1]
    && process.argv[1].endsWith('verify-signatures.mjs');
if (invokedDirectly) {
    const [, , dir, expected] = process.argv;
    if (!dir || !expected) {
        process.stderr.write('usage: verify-signatures.mjs <artifact-dir> <expected-artifacts.txt>\n');
        process.exit(2);
    }
    process.exit(run(dir, expected));
}
