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

// tools/release/verify-apk-signer.mjs - refuse a direct APK whose signer is
// not the K10 certificate pinned in SECURITY.md.
//
// Usage:
//     node tools/release/verify-apk-signer.mjs <apk> [--security <SECURITY.md>]
//
// `apksigner verify` passes for ANY valid signer; this checks WHOSE it is. K10
// cannot be rotated, so a wrong-keystore APK that ships splits the direct
// install base for good (SECURITY.md, "Android APK signing certificate").

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_SECURITY_MD = fileURLToPath(new URL('../../SECURITY.md', import.meta.url));

// Read the K10 pin out of SECURITY.md's Android section, as 64 lowercase hex digits.
export function readPinnedK10(securityText) {
    const section = /^### Android APK signing certificate\n([\s\S]*?)(?=^#{1,3} |^---$|(?![\s\S]))/m
        .exec(String(securityText));
    if (!section) {
        throw new Error('SECURITY.md has no "### Android APK signing certificate" section to read the K10 pin from');
    }
    const block = /Fingerprint \(SHA-256\):[ \t]*\n((?:[ \t]+[0-9A-Fa-f:]+[ \t]*\n?)+)/.exec(section[1]);
    if (!block) {
        throw new Error('the Android section of SECURITY.md has no "Fingerprint (SHA-256):" block');
    }
    const hex = block[1].replace(/[\s:]/g, '').toLowerCase();
    // Refuse a pin that is not a whole SHA-256: a truncated copy would match nothing, or worse, a prefix.
    if (!/^[0-9a-f]{64}$/.test(hex)) {
        throw new Error(`the K10 pin in SECURITY.md is not a SHA-256 digest (read ${hex.length} hex digits)`);
    }
    return hex;
}

// Collect each signer's certificate SHA-256 from `apksigner verify --print-certs` output.
export function signerCertDigests(printCertsOutput) {
    return [...String(printCertsOutput).matchAll(/^Signer #\d+ certificate SHA-256 digest:\s*([0-9A-Fa-f:]+)\s*$/gm)]
        .map((m) => m[1].replace(/:/g, '').toLowerCase());
}

// Format bare hex as the colon-separated uppercase form SECURITY.md publishes.
export function colonFingerprint(hex) {
    return String(hex).toUpperCase().match(/.{1,2}/g)?.join(':') ?? '';
}

// Judge the signer set: exactly one signer, and it is the pinned K10 certificate.
export function judgeSigner(digests, pin) {
    // Refuse when no signer could be read (fail closed: an unreadable answer is not a match).
    if (digests.length === 0) {
        return { ok: false, reason: 'apksigner printed no "Signer #N certificate SHA-256 digest" line' };
    }
    // Refuse extra signers: the direct APK is signed by K10 alone.
    if (digests.length > 1) {
        return { ok: false, reason: `the APK carries ${digests.length} signer certificates; K10 signs it alone` };
    }
    // Refuse any signer whose certificate is not the published one.
    if (digests[0] !== pin) {
        return {
            ok: false,
            reason: `the signer certificate is ${colonFingerprint(digests[0])}, `
                + `not the K10 certificate SECURITY.md pins (${colonFingerprint(pin)})`,
        };
    }
    return { ok: true, reason: `signed by the pinned K10 certificate ${colonFingerprint(pin)}` };
}

const USAGE = `Usage: node tools/release/verify-apk-signer.mjs <apk> [--security <SECURITY.md>]

Refuses a direct-download APK whose signer certificate is not the K10
fingerprint pinned in SECURITY.md ("Android APK signing certificate").
Runs \`apksigner verify --print-certs\`, so apksigner must be on PATH.
Exit 0: signed by K10 alone. Exit 1: wrong, extra or unreadable signer. Exit 2: usage.`;

function main(argv) {
    let apk = null;
    let securityPath = DEFAULT_SECURITY_MD;
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--security') {
            securityPath = argv[i + 1];
            i += 1;
        } else if (argv[i] === '--help' || argv[i] === '-h') {
            console.log(USAGE);
            return 0;
        } else if (!apk) {
            apk = argv[i];
        } else {
            console.error(`verify-apk-signer: unexpected argument '${argv[i]}'`);
            return 2;
        }
    }
    if (!apk || !securityPath) {
        console.error(USAGE);
        return 2;
    }

    let pin;
    try {
        pin = readPinnedK10(readFileSync(securityPath, 'utf8'));
    } catch (err) {
        console.error(`verify-apk-signer: ${err.message}`);
        return 1;
    }

    const run = spawnSync('apksigner', ['verify', '--print-certs', apk], { encoding: 'utf8' });
    if (run.error || run.status !== 0) {
        const why = run.error ? run.error.message : (run.stderr || '').trim() || `exit ${run.status}`;
        console.error(`verify-apk-signer: apksigner could not read the certificates of ${apk}: ${why}`);
        return 1;
    }

    const verdict = judgeSigner(signerCertDigests(run.stdout), pin);
    if (!verdict.ok) {
        console.error(`verify-apk-signer: ${apk}: ${verdict.reason}`);
        return 1;
    }
    console.log(`verify-apk-signer: ${apk}: ${verdict.reason}`);
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(main(process.argv.slice(2)));
}
