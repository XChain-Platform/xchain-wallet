// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// cws-upload.mjs must read the SIGNATURE, not the presence of a file.
//
// WHAT THIS PINS. Until 2026-08-15 the tool's provenance gate set
// `signed = true` on a successful stat() of `<manifest>.asc`. A zero-byte
// .asc, or one carrying anybody's signature over anything, therefore made the
// tool report `signed` and upload to the Chrome Web Store. The gap was driven
// with a control: an empty .asc returned signed pre-fix and is refused
// post-fix, checked against real gpg in a throwaway GNUPGHOME.
//
// cws-upload.smoke.js already covers the manifest half of that gate (missing,
// unsigned, unlisted, tampered bytes). What it never drove is the signature
// itself, which is the half that reads as done and was not - the same shape
// S37 found in verify.sh, on the same .asc, against the same key.
//
// TWO LAYERS, both of which have to run. The stub layer drives
// attributeSignature against gpg's machine-readable status directly and runs
// on every machine, including one with no gpg; it is where the exact
// verdicts live, in particular that a `Good signature from` line with no
// VALIDSIG is a refusal, because reading gpg's exit code is the original bug
// one level down. The real-gpg layer proves the stub is not fiction: keys are
// generated, a manifest is really signed, and the tool is run as an operator
// runs it. Only the second layer skips.
//
// The happy path stops at --dry-run on purpose. A test that uploads to the
// Chrome Web Store on every CI run is a worse idea than an untested success
// branch, which is the rule cws-upload.smoke.js established.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const walletRoot = join(here, '..', '..', '..');
const TOOL = join(walletRoot, 'tools', 'release', 'cws-upload.mjs');
const ITEM = 'abcdefghijklmnopabcdefghijklmnop';
const ZIP_NAME = 'xchain-wallet-extension-v9.9.9.zip';

const { attributeSignature, checkProvenance, Refusal } = await import(TOOL);

const failures = [];
const check = (what, ok, detail = '') => {
    if (ok) return;
    failures.push(`${what}${detail ? `\n    ${detail.trim().split('\n').slice(-8).join('\n    ')}` : ''}`);
};

const work = mkdtempSync(join(tmpdir(), 'xc1513-cws-'));

// Two fingerprints that are not each other. K1's real shape is a certify-only
// primary with a signing subkey, so the fingerprint published on
// xchain.io/security is never the one that made the signature.
const K1_PRIMARY = 'A'.repeat(40);
const K1_SUBKEY = 'B'.repeat(40);
const OTHER_KEY = 'C'.repeat(40);

/** A manifest and a zip that agree, so the only variable is the signature. */
function stagedRelease(dir) {
    mkdirSync(dir, { recursive: true });
    const zip = join(dir, ZIP_NAME);
    writeFileSync(zip, 'pretend release bytes\n');
    const sha = createHash('sha256').update(readFileSync(zip)).digest('hex');
    const manifest = join(dir, 'RELEASE_HASHES.txt');
    writeFileSync(manifest, [
        '# XChain Wallet release manifest',
        '# manifest-version: 2',
        '# tag: v9.9.9',
        '# tag-commit: 0000000000000000000000000000000000000000',
        '# built: 2026-01-01T00:00:00Z',
        '# dev-mock-gate: enforced',
        '# artifacts: 1',
        `# profile default: ./${ZIP_NAME}`,
        `${sha}  ./${ZIP_NAME}`,
        '',
    ].join('\n'));
    return { zip, manifest, sha };
}

/** A stand-in for gpg that answers with one canned status stream. */
const gpgSaying = (stdout, status = 0) => () => ({ status, stdout, stderr: '' });

try {
    // --- 1. The verdicts, read off gpg's status stream ------------------
    const cases = [
        // A zero-byte .asc: gpg finds no signature packet at all. This is THE
        // regression - pre-fix nothing here was ever consulted.
        ['a zero-byte .asc', 'bad',
            '[GNUPG:] NODATA 1\n[GNUPG:] NODATA 2\n', 2],
        // A good signature from a key that is not the release key. gpg exits
        // 0 and prints `Good signature`, which is why neither is read.
        ['a GOOD signature from the WRONG key', 'wrong-key',
            `[GNUPG:] GOODSIG 0 Somebody <s@example.invalid>\n[GNUPG:] VALIDSIG ${OTHER_KEY} `
            + `2026-01-01 0 4 0 22 8 00 ${OTHER_KEY}\n`, 0],
        // The genuine K1 shape: the SUBKEY signs, the PRIMARY is published.
        ['a genuine signature named by the published primary', 'ok',
            `[GNUPG:] VALIDSIG ${K1_SUBKEY} 2026-01-01 0 4 0 22 8 00 ${K1_PRIMARY}\n`, 0],
        // And the same signature named by the subkey that made it.
        ['a genuine signature named by the signing subkey', 'ok',
            `[GNUPG:] VALIDSIG ${K1_SUBKEY} 2026-01-01 0 4 0 22 8 00 ${K1_PRIMARY}\n`, 0],
        // Human text and a zero exit with NO status line. A tool that read
        // either would call this verified.
        ['`Good signature from` with no VALIDSIG', 'bad',
            'gpg: Good signature from "XChain Release Key"\n', 0],
    ];
    for (const [label, want, stdout, status] of cases) {
        const fingerprint = label.includes('subkey') && want === 'ok' ? K1_SUBKEY : K1_PRIMARY;
        const verdict = attributeSignature({
            manifestPath: join(work, 'RELEASE_HASHES.txt'), fingerprint, runImpl: gpgSaying(stdout, status),
        });
        check(`attributeSignature reports '${want}' for ${label}`, verdict === want,
            `got '${verdict}'`);
    }

    // gpg absent is not a pass. A check that cannot run has not run.
    check('attributeSignature reports no-gpg rather than ok when gpg is missing',
        attributeSignature({
            manifestPath: join(work, 'RELEASE_HASHES.txt'), fingerprint: K1_PRIMARY,
            runImpl: () => ({ error: Object.assign(new Error('spawn gpg ENOENT'), { code: 'ENOENT' }) }),
        }) === 'no-gpg');

    // --- 2. The gate acts on the verdict --------------------------------
    //
    // attributeSignature can be perfect and the gate still upload, which is
    // precisely what happened: the verdict is only worth what checkProvenance
    // does with it.
    const staged = stagedRelease(join(work, 'staged'));
    writeFileSync(`${staged.manifest}.asc`, '');

    const provenance = (runImpl, allowUnsigned = false) => checkProvenance({
        zipPath: staged.zip, manifestPath: staged.manifest, allowUnsigned, runImpl,
    });

    process.env.XCHAIN_VERIFY_KEY = K1_PRIMARY;

    for (const [label, stdout, status, pattern] of [
        ['a zero-byte .asc', '[GNUPG:] NODATA 1\n', 2, /did not verify/],
        ['a signature from the wrong key',
            `[GNUPG:] VALIDSIG ${OTHER_KEY} 2026-01-01 0 4 0 22 8 00 ${OTHER_KEY}\n`, 0,
            /GOOD and it is from the WRONG KEY/],
        ['gpg missing entirely', '', 0, /gpg is not on PATH/],
    ]) {
        const runImpl = label === 'gpg missing entirely'
            ? () => ({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) })
            : gpgSaying(stdout, status);
        let refused = null;
        try {
            const out = await provenance(runImpl);
            check(`checkProvenance REFUSES ${label}`, false,
                `it returned signed=${out.signed} (${out.signature}), so this zip would be uploaded`);
        } catch (err) {
            refused = err;
        }
        if (!refused) continue;
        check(`checkProvenance refuses ${label} as a Refusal`, refused instanceof Refusal,
            String(refused));
        check(`and says WHICH failure it was for ${label}`, pattern.test(refused.message),
            refused.message);
    }

    // The genuine signature is accepted, or the refusals above are a wall.
    {
        const out = await provenance(gpgSaying(
            `[GNUPG:] VALIDSIG ${K1_SUBKEY} 2026-01-01 0 4 0 22 8 00 ${K1_PRIMARY}\n`));
        check('checkProvenance accepts the genuine signature', out.signed === true, out.signature);
        check('and attributes it to the pinned fingerprint rather than saying only that it was good',
            out.signature.includes(K1_PRIMARY), out.signature);
    }

    // --- 3. --allow-unsigned stays the ONE named escape ------------------
    //
    // The flag has to keep working: a refusal with no way past it is what
    // pushes an operator to a hand-run upload, which is strictly worse than
    // the gate they bypassed.
    {
        const out = await provenance(gpgSaying('[GNUPG:] NODATA 1\n', 2), true);
        check('--allow-unsigned still lets a bad signature through, and says so',
            out.signed === false, out.signature);
    }
    delete process.env.XCHAIN_VERIFY_KEY;

    // --- 4. The same three inputs, against real gpg ---------------------
    if (spawnSync('gpg', ['--version'], { encoding: 'utf8' }).status === 0) {
        const gnupg = join(work, 'gnupg');
        mkdirSync(gnupg, { mode: 0o700 });
        const gpgEnv = { ...process.env, GNUPGHOME: gnupg };
        const gpg = (...args) => execFileSync('gpg', ['--batch', '--quiet', ...args],
            { env: gpgEnv, encoding: 'utf8' });
        try {
            gpg('--passphrase', '', '--quick-generate-key',
                'XC1513 Release <release@example.invalid>', 'ed25519', 'cert', '0');
            const fprs = (uid) => {
                const lines = gpg('--list-keys', '--with-colons', uid).split('\n');
                const primary = lines.find((l) => l.startsWith('fpr:'))?.split(':')[9];
                const subIdx = lines.findIndex((l) => l.startsWith('sub:'));
                return { primary, sub: subIdx === -1 ? null : lines[subIdx + 1]?.split(':')[9] ?? null };
            };
            gpg('--passphrase', '', '--quick-add-key', fprs('release@example.invalid').primary,
                'ed25519', 'sign', '0');
            const K1 = fprs('release@example.invalid');
            check('the throwaway release key has a signing subkey distinct from its primary',
                K1.sub && K1.sub !== K1.primary, `primary=${K1.primary} sub=${K1.sub}`);
            gpg('--passphrase', '', '--quick-generate-key',
                'XC1513 Other <other@example.invalid>', 'ed25519', 'sign', '0');
            const OTHER = fprs('other@example.invalid');

            const real = stagedRelease(join(work, 'real'));

            /* Run the tool the way an operator does. Credentials are dummy
             * strings and every run is --dry-run, so nothing leaves the box;
             * the point is which exit the provenance gate takes. */
            const run = (extra = []) => spawnSync('node', [TOOL, '--item-id', ITEM,
                '--zip', real.zip, '--manifest', real.manifest, '--dry-run', ...extra], {
                encoding: 'utf8',
                env: {
                    ...gpgEnv,
                    XCHAIN_VERIFY_KEY: K1.primary,
                    CWS_CLIENT_ID: 'dummy-id', CWS_CLIENT_SECRET: 'dummy-secret',
                    CWS_REFRESH_TOKEN: 'dummy-token',
                },
            });
            const sign = (fpr) => gpg('--yes', '--local-user', fpr, '--armor', '--detach-sign',
                '--output', `${real.manifest}.asc`, real.manifest);

            // (a) CONTROL: really signed by the release key, named by the
            //     primary a user reads. Without this the refusals prove
            //     nothing but that the tool refuses.
            sign(K1.primary);
            const good = run();
            check('REAL GPG: a genuinely signed manifest passes the gate',
                good.status === 0, `${good.stdout}\n${good.stderr}`);
            check('REAL GPG: and the tool names the key it bound to',
                good.stdout.includes(`signed by ${K1.primary}`), good.stdout);

            // (b) THE FINDING: a zero-byte .asc. Pre-fix this printed
            //     `signed` and uploaded.
            writeFileSync(`${real.manifest}.asc`, '');
            const empty = run();
            check('REAL GPG: a ZERO-BYTE .asc is refused', empty.status === 1,
                `status=${empty.status}\n${empty.stdout}\n${empty.stderr}`);
            check('REAL GPG: and the output never claims the manifest was signed',
                !/signed by [0-9A-F]{40}/.test(empty.stdout + empty.stderr),
                empty.stdout + empty.stderr);

            // (c) an .asc that is a real signature, from the wrong key.
            sign(OTHER.primary);
            const wrong = run();
            check('REAL GPG: a good signature from the WRONG key is refused', wrong.status === 1,
                `status=${wrong.status}\n${wrong.stdout}\n${wrong.stderr}`);
            check('REAL GPG: and the diagnosis names the key, not just the signature',
                /WRONG KEY/.test(wrong.stderr) && wrong.stderr.includes(K1.primary), wrong.stderr);

            // (d) an .asc holding arbitrary armoured text rather than a
            //     signature over this manifest: the "any file will do" case.
            writeFileSync(`${real.manifest}.asc`,
                '-----BEGIN PGP SIGNATURE-----\n\nbm90IGEgc2lnbmF0dXJl\n-----END PGP SIGNATURE-----\n');
            const junk = run();
            check('REAL GPG: an .asc that is not a signature over these bytes is refused',
                junk.status === 1, `status=${junk.status}\n${junk.stdout}\n${junk.stderr}`);
        } finally {
            spawnSync('gpgconf', ['--kill', 'gpg-agent'], { env: gpgEnv });
        }
    } else if (process.env.CI) {
        // A SKIP IS A PASS EVERYWHERE ELSE AND MUST NOT BE ONE HERE: this refusal
        // must run on a RUNNER, not only the release machine, or a runner that
        // quietly lost gpg would report green with the real-signature cases
        // never executed.
        check('CI: the REAL GPG cases ran rather than skipping', false,
            'gpg is not on PATH on this runner, so the signature refusals were not driven against '
            + 'real signatures. Install gnupg in the workflow rather than letting the skip stand.');
    } else {
        process.stderr.write('cws-upload-signature.smoke.js: gpg is not installed, so the REAL GPG '
            + 'cases were not run. The verdict and gate checks above still ran.\n');
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
    console.error(`FAIL cws-upload-signature.smoke.js: ${failures.length} check(s) failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}

console.log('PASS cws-upload-signature.smoke.js (the provenance gate reads gpg\'s VALIDSIG '
    + 'rather than the existence of a .asc, so a zero-byte signature, one from the wrong key, one '
    + 'that is not a signature at all, and a missing gpg are each refused with their own diagnosis, '
    + 'while a genuine subkey signature under the published primary passes)');
