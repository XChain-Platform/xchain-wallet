// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/verify-apk-signer.mjs, shown a right and a wrong K10 signer.
//
// The pin is read from the real SECURITY.md and the CLI is driven under a stub
// apksigner, so a wrong-keystore APK is shown to the gate rather than assumed.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    colonFingerprint,
    judgeSigner,
    readPinnedK10,
    signerCertDigests,
} from '../../../tools/release/verify-apk-signer.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const VERIFIER = join(root, 'tools/release/verify-apk-signer.mjs');
const security = readFileSync(join(root, 'SECURITY.md'), 'utf8');

// The pin is the published one, and it agrees with the App Links copy.
const pin = readPinnedK10(security);
assert.match(pin, /^[0-9a-f]{64}$/, 'the K10 pin reads as a whole SHA-256');
assert.ok(pin.startsWith('4b5de091') && pin.endsWith('259e28'), 'the pin is the published K10 fingerprint');
const assetlinks = JSON.parse(readFileSync(join(root, 'packages/mobile/assetlinks.template.json'), 'utf8'));
const linked = assetlinks.flatMap((s) => s.target?.sha256_cert_fingerprints || [])
    .map((fp) => fp.replace(/:/g, '').toLowerCase());
assert.ok(linked.includes(pin), 'assetlinks.template.json carries the same K10 certificate the gate pins');

// A pin that is missing or cut short is an error, never a pass.
assert.throws(() => readPinnedK10('# Security\n\nno android section\n'), /no "### Android APK signing certificate"/);
assert.throws(
    () => readPinnedK10('### Android APK signing certificate\n\n    Fingerprint (SHA-256):\n    4B:5D:E0\n'),
    /not a SHA-256 digest/,
);

const WRONG = 'ab'.repeat(32);
const printCerts = (...digests) => digests
    .map((d, i) => `Signer #${i + 1} certificate DN: CN=test\n`
        + `Signer #${i + 1} certificate SHA-256 digest: ${d}\n`
        + `Signer #${i + 1} certificate SHA-1 digest: ${'cd'.repeat(20)}\n`)
    .join('');

// The parser reads signer certificates only, never public-key or source-stamp digests.
assert.deepEqual(signerCertDigests(printCerts(pin)), [pin]);
assert.deepEqual(
    signerCertDigests(`Source Stamp Signer certificate SHA-256 digest: ${WRONG}\n${printCerts(pin)}`
        + `Signer #1 public key SHA-256 digest: ${WRONG}\n`),
    [pin],
);
assert.deepEqual(signerCertDigests(printCerts(colonFingerprint(pin))), [pin], 'a colon-separated digest reads the same');

// The judgement: one signer, and it is the pinned certificate.
assert.equal(judgeSigner([pin], pin).ok, true);
assert.equal(judgeSigner([WRONG], pin).ok, false);
assert.match(judgeSigner([WRONG], pin).reason, /not the K10 certificate SECURITY\.md pins/);
assert.equal(judgeSigner([], pin).ok, false, 'no readable signer fails closed');
assert.equal(judgeSigner([pin, WRONG], pin).ok, false, 'a second signer is refused');

// The CLI, driven end to end under a stub apksigner that prints a chosen signer.
const work = mkdtempSync(join(tmpdir(), 'xc-apk-signer-'));
try {
    const bin = join(work, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'apksigner'),
        '#!/bin/sh\n'
        + '# Stub: apksigner verify --print-certs, for apk-signer-pin.smoke.js.\n'
        + '[ "$1" = "verify" ] && [ "$2" = "--print-certs" ] || exit 64\n'
        + '[ -n "$STUB_FAIL" ] && { echo "DOES NOT VERIFY" >&2; exit 1; }\n'
        + 'printf "Signer #1 certificate DN: CN=stub\\nSigner #1 certificate SHA-256 digest: %s\\n" "$STUB_DIGEST"\n');
    chmodSync(join(bin, 'apksigner'), 0o755);
    const apk = join(work, 'xchain-wallet-v0.0.1.apk');
    writeFileSync(apk, 'not-a-real-apk');
    const drive = (env) => spawnSync(process.execPath, [VERIFIER, apk], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
    });

    const good = drive({ STUB_DIGEST: pin });
    assert.equal(good.status, 0, `the pinned signer passes: ${good.stderr}`);

    const wrong = drive({ STUB_DIGEST: WRONG });
    assert.equal(wrong.status, 1, 'a wrong-keystore APK is refused');
    assert.match(wrong.stderr, /not the K10 certificate SECURITY\.md pins/, 'and the refusal says why');

    const unreadable = drive({ STUB_DIGEST: pin, STUB_FAIL: '1' });
    assert.equal(unreadable.status, 1, 'an APK apksigner cannot read is refused, not waved through');

    const ceremony = readFileSync(join(root, 'tools/release/android-ceremony.sh'), 'utf8');
    const calls = ceremony.split('\n').filter((l) => !/^\s*#/.test(l) && l.includes('verify-apk-signer.mjs'));
    assert.equal(calls.length, 2, 'the ceremony runs the signer check on both direct APKs');
    for (const [what, staged] of [
        ['store', 'mv "$WORK_DIR/$APK_NAME" "$OUTPUT_DIR/$APK_NAME"'],
        ['full', 'mv "$WORK_DIR/$FULL_APK_NAME" "$OUTPUT_DIR/$FULL_APK_NAME"'],
    ]) {
        const checkAt = ceremony.indexOf(what === 'store'
            ? 'verify-apk-signer.mjs" "$WORK_DIR/$APK_NAME"'
            : 'verify-apk-signer.mjs" "$WORK_DIR/$FULL_APK_NAME"');
        assert.ok(checkAt > 0 && checkAt < ceremony.indexOf(staged),
            `the ${what} APK's signer is checked before it is staged`);
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

console.log('apk-signer-pin: the direct APK gate refuses any signer but the pinned K10 certificate');
