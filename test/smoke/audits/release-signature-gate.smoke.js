// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for : a release must not be able to ship UNSIGNED artifacts
// while every other gate reports green.
//
// The defect this guards is one missing repository secret. Windows signing
// is selected off three environment variables and the desktop build config
// says plainly that with them unset it "is entirely inert ... still
// produces unsigned artifacts"; macOS skips signing with a warning. The
// artifact-set gate counts files and architectures, and `sign.sh` then
// hashes whatever it finds into a K1-signed manifest that verifies
// perfectly over unsigned installers.
//
// So the interesting cases here are not "does it pass on a good build".
// They are the two shapes of silence: an artifact that should carry a
// signature and does not, and a class that was never checked reading as
// though it had been.
//
// FIXTURES ARE BUILT BYTE BY BYTE rather than committed, because the thing
// under test is a parse of a specific field. A committed "unsigned.exe"
// would prove the parser agrees with whatever produced that file; a PE
// assembled here with the certificate table set and cleared proves it
// reads THAT field and not something correlated with it.

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));

import {
    peHasCertificateTable,
    zipHasCodeSignature,
    assessDiskImage,
    checkArtifact,
    summarise,
    parseExpected,
    SIGNATURE_CLASSES,
} from '../../../tools/release/verify-signatures.mjs';

const work = mkdtempSync(join(tmpdir(), 'xchain-signgate-'));

/**
 * Assemble a minimal PE32+ binary.
 *
 * @param {{certAddr?: number, certSize?: number, numRva?: number, magic?: number}} opts
 */
function makePE({ certAddr = 0, certSize = 0, numRva = 16, magic = 0x20b } = {}) {
    const peOff = 0x80;
    const buf = Buffer.alloc(0x400);
    buf.writeUInt16LE(0x5a4d, 0);            // MZ
    buf.writeUInt32LE(peOff, 0x3c);          // e_lfanew
    buf.writeUInt32LE(0x00004550, peOff);    // PE\0\0
    const optOff = peOff + 24;
    buf.writeUInt16LE(magic, optOff);
    const numRvaOff = magic === 0x20b ? optOff + 108 : optOff + 92;
    const ddOff = magic === 0x20b ? optOff + 112 : optOff + 96;
    buf.writeUInt32LE(numRva, numRvaOff);
    buf.writeUInt32LE(certAddr, ddOff + 4 * 8);
    buf.writeUInt32LE(certSize, ddOff + 4 * 8 + 4);
    return buf;
}

// --- the PE certificate table, read both ways --------------------------

{
    const signed = peHasCertificateTable(makePE({ certAddr: 0x9000, certSize: 4242 }));
    assert.equal(signed.ok, true, 'a PE with a populated certificate table reads as signed');
    assert.match(signed.reason, /4242 bytes/);

    const unsigned = peHasCertificateTable(makePE({ certAddr: 0, certSize: 0 }));
    assert.equal(unsigned.ok, false, 'a zeroed certificate table is the unsigned case');
    assert.match(unsigned.reason, /UNSIGNED/);

    // Half-zeroed counts as unsigned too. Both fields are written together
    // by the signer, so one set and one clear is a malformed file, not a
    // signature, and guessing in its favour is the wrong direction.
    assert.equal(peHasCertificateTable(makePE({ certAddr: 0x9000, certSize: 0 })).ok, false);
    assert.equal(peHasCertificateTable(makePE({ certAddr: 0, certSize: 4242 })).ok, false);
}

{
    // PE32 puts the data directory 16 bytes earlier than PE32+. Reading the
    // wrong offset would find whatever happens to sit there, so a PE32
    // binary is checked explicitly rather than assumed to be absent: NSIS
    // stubs have shipped 32-bit before.
    const signed32 = peHasCertificateTable(makePE({ certAddr: 0x9000, certSize: 77, magic: 0x10b }));
    assert.equal(signed32.ok, true, 'PE32 optional-header layout is handled, not only PE32+');
    assert.equal(peHasCertificateTable(makePE({ magic: 0x10b })).ok, false);
}

{
    // A binary with fewer than five data directories cannot carry a
    // certificate table at all, and must not be read as if index 4 existed.
    const short = peHasCertificateTable(makePE({ certAddr: 0x9000, certSize: 12, numRva: 3 }));
    assert.equal(short.ok, false);
    assert.match(short.reason, /only 3 data directories/);
}

{
    // Not a PE at all is a FAILURE, never a skip: this path is only
    // reached by a row that declared `authenticode`, so a non-PE there
    // means the artifact is not what the declaration says it is.
    assert.equal(peHasCertificateTable(Buffer.from('this is not an executable')).ok, false);
    assert.match(peHasCertificateTable(Buffer.alloc(8)).reason, /not a PE/);
    const badPe = makePE({ certAddr: 1, certSize: 1 });
    badPe.writeUInt32LE(0xdeadbeef, 0x80);   // clobber the PE signature
    assert.match(peHasCertificateTable(badPe).reason, /not a PE/);
}

// --- the macOS sealed-signature marker ---------------------------------

{
    const sealed = Buffer.concat([
        Buffer.from('PKfake zip header'),
        Buffer.from('XChain Wallet.app/Contents/_CodeSignature/CodeResources'),
    ]);
    assert.equal(zipHasCodeSignature(sealed).ok, true);

    const bare = Buffer.concat([
        Buffer.from('PKfake zip header'),
        Buffer.from('XChain Wallet.app/Contents/MacOS/XChain Wallet'),
    ]);
    const res = zipHasCodeSignature(bare);
    assert.equal(res.ok, false, 'an app bundle with no sealed signature is the unsigned case');
    assert.match(res.reason, /UNSIGNED/);
}

// --- classes that are recorded must never read as checked --------------

{
    // This is the assertion the whole file exists for. `store`, `none`,
    // and the two deferred classes are not verified, and the tool must say
    // so in a way no summary can round up into "ok".
    for (const [cls, spec] of Object.entries(SIGNATURE_CLASSES)) {
        if (spec.verify) continue;
        const r = checkArtifact('/nonexistent/whatever', cls);
        assert.equal(r.state, 'recorded',
            `${cls} is not verified, so it must report 'recorded'`);
        assert.notEqual(r.state, 'ok',
            `${cls} must never report 'ok': that is the "we did not look" hole`);
    }

    // And a class nobody defined is a hard failure at declaration time,
    // rather than being quietly treated as unchecked. A typo in the
    // artifact table would otherwise disable the gate for that row.
    const typo = checkArtifact('/nonexistent/whatever', 'authenitcode');
    assert.equal(typo.state, 'failed');
    assert.match(typo.reason, /unknown signature class/);
}

// --- end to end, over files on disk ------------------------------------

{
    const goodExe = join(work, 'xchain-wallet-setup-0.335.0-x64.exe');
    const badExe = join(work, 'xchain-wallet-setup-0.335.0-arm64.exe');
    const goodZip = join(work, 'xchain-wallet-0.335.0-x64-mac.zip');
    writeFileSync(goodExe, makePE({ certAddr: 0x9000, certSize: 4242 }));
    writeFileSync(badExe, makePE());
    writeFileSync(goodZip, Buffer.from('PK XChain Wallet.app/Contents/_CodeSignature/CodeResources'));

    const results = [
        checkArtifact(goodExe, 'authenticode'),
        checkArtifact(badExe, 'authenticode'),
        checkArtifact(goodZip, 'codesign'),
        checkArtifact(join(work, 'xchain-wallet-0.335.0.AppImage'), 'none'),
        // The dmg is CHECKED now (row 140), so it is driven here on a
        // stubbed assessment rather than counted as recorded. The stub is
        // the real spctl output shape, verbatim from the published
        // v0.338.0 artifact on the good side.
        checkArtifact(join(work, 'xchain-wallet-0.335.0-x64.dmg'), 'codesign-dmg', {
            platform: 'darwin',
            run: () => ({ status: 0, stdout: '', stderr: 'x.dmg: accepted\nsource=Notarized Developer ID\n' }),
        }),
    ];
    const sum = summarise(results);

    assert.equal(sum.ok, 3, 'the signed exe, the signed mac zip and the notarized dmg');
    assert.equal(sum.failed, 1, 'the unsigned arm64 installer must fail');
    assert.equal(sum.recorded, 1, 'the AppImage alone is recorded, not checked');
    assert.equal(sum.failures[0].file, 'xchain-wallet-setup-0.335.0-arm64.exe');
    assert.match(sum.failures[0].reason, /UNSIGNED/);

    // THE SHAPE THAT MOTIVATED ALL OF THIS: a release where the signing
    // secret was missing, so every artifact built, every name and arch is
    // right, and not one of them is signed. It must fail, and it must fail
    // naming every artifact rather than only the first.
    const wholeReleaseUnsigned = summarise([
        checkArtifact(badExe, 'authenticode'),
        checkArtifact(badExe, 'authenticode'),
    ]);
    assert.equal(wholeReleaseUnsigned.ok, 0);
    assert.equal(wholeReleaseUnsigned.failed, 2,
        'every unsigned artifact is reported, not just the first');
}

// --- the disk image itself ( row 140) ----------------------------
//
// THE CASE THIS EXISTS FOR IS A REAL RELEASE, NOT A HYPOTHETICAL. v0.338.0
// published a .dmg whose app bundle was signed, notarized and stapled and
// whose CONTAINER was not signed at all, and the gate said nothing because
// the dmg's class declared it "Apple-signed" and skipped it on that basis.
// The rejected output below is the verbatim assessment of that published
// artifact.
{
    const dmg = join(work, 'xchain-wallet-0.338.0-arm64.dmg');

    const published = assessDiskImage(dmg, {
        platform: 'darwin',
        run: () => ({ status: 3, stdout: '', stderr: `${dmg}: rejected\nsource=no usable signature\n` }),
    });
    assert.equal(published.state, 'failed', 'an unsigned disk image must fail, not record');
    assert.match(published.reason, /UNNOTARIZED/);
    assert.match(published.reason, /no usable signature/);

    // A dmg can be validly SIGNED and still warn, because what clears the
    // warning is the ticket. Signed-but-not-notarized must fail too, or
    // the fix for row 140 could be "half applied" and read as green.
    const signedNotNotarized = assessDiskImage(dmg, {
        platform: 'darwin',
        run: () => ({ status: 3, stdout: '', stderr: `${dmg}: rejected\nsource=Unnotarized Developer ID\n` }),
    });
    assert.equal(signedNotNotarized.state, 'failed',
        'a signed image with no notarization ticket still shows the warning');

    const good = assessDiskImage(dmg, {
        platform: 'darwin',
        run: () => ({ status: 0, stdout: '', stderr: `${dmg}: accepted\nsource=Notarized Developer ID\n` }),
    });
    assert.equal(good.state, 'ok');

    // Off macOS it records and SAYS it recorded. The reason must not be
    // mistakable for a pass: this is the exact shape the old class got
    // wrong, where a skip read as an assurance.
    const onLinux = assessDiskImage(dmg, {
        platform: 'linux',
        run: () => { throw new Error('spctl must not be invoked off macOS'); },
    });
    assert.equal(onLinux.state, 'recorded');
    assert.match(onLinux.reason, /NOT CHECKED/);
}

// --- the real declaration, and the wiring that enforces it -------------

{
    const root = join(here, '..', '..', '..');
    const expected = readFileSync(join(root, 'tools/release/expected-artifacts.txt'), 'utf8');
    const { rows, problems } = parseExpected(expected);

    assert.deepEqual(problems, [],
        'every row in expected-artifacts.txt must declare a known signature class');
    assert.ok(rows.length >= 14, `expected the full artifact set, got ${rows.length} rows`);

    // The two lanes whose build config can silently skip signing are the
    // reason this gate exists, so they must be the VERIFIED classes and
    // not quietly demoted to a recorded one later.
    const byPattern = Object.fromEntries(rows.map((r) => [r.pattern, r.cls]));
    assert.equal(byPattern['*.exe'], 'authenticode',
        'the Windows installer is the artifact a missing Azure secret leaves unsigned');
    assert.equal(byPattern['*mac*.zip'], 'codesign',
        'the mac zip is the update-capable mac artifact and is checkable anywhere');
    assert.ok(SIGNATURE_CLASSES[byPattern['*.exe']].verify);
    assert.ok(SIGNATURE_CLASSES[byPattern['*mac*.zip']].verify);

    // Linux genuinely has no OS signature; declaring it anything else
    // would make the gate fail every release for a non-defect.
    assert.equal(byPattern['*.AppImage'], 'none');
    assert.equal(byPattern['*.deb'], 'none');

    // A declaration is only a gate if something runs it. sign.sh must call
    // it BEFORE writing the manifest: K1 attests bytes, not publishers, so
    // a manifest over unsigned artifacts verifies perfectly and nothing
    // downstream can tell afterwards.
    // Compare the INVOCATIONS, not the first textual mention. The first
    // draft of this assertion compared `indexOf` on the raw text and failed
    // against correct code, because the comment explaining the ordering
    // names `xr_write_manifest` six lines above the gate call. A test that
    // can be broken by a comment is not testing the wiring.
    const signLines = readFileSync(join(root, 'tools/release/sign.sh'), 'utf8').split('\n');
    const lineOf = (rx) => signLines.findIndex((l) => rx.test(l));
    const gateAt = lineOf(/^\s*node .*verify-signatures\.mjs/);
    const manifestAt = lineOf(/^\s*xr_write_manifest\s/);

    assert.ok(gateAt !== -1, 'sign.sh must invoke the signature gate');
    assert.ok(manifestAt !== -1, 'sign.sh must still write a manifest');
    assert.ok(gateAt < manifestAt,
        'the signature gate must run BEFORE the manifest is written: K1 attests '
        + 'bytes, not publishers, so a manifest over unsigned artifacts verifies '
        + 'perfectly and nothing downstream can tell afterwards');
}

rmSync(work, { recursive: true, force: true });
process.stdout.write('release-signature-gate.smoke.js: ok\n');
