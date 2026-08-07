// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// verify.sh must refuse a GOOD signature from the WRONG KEY ( S37).
//
// This is the check that reads as already done and was not. Until
// 2026-08-06 verify.sh ran a bare `gpg --verify`, which answers "did
// somebody in your keyring sign this" and prints `Good signature from
// <uid>` when the answer is yes. On a keyring holding one key that is
// indistinguishable from "the release key signed this". On a keyring
// holding several it is not, and this project ships three keys that the
// verify-release page states outright are not interchangeable: the
// wallet release key K1, the tag-signing key, and the platform key at
// releases@xchain.io. The release machine holds all three by design.
//
// How it was found is the reason this file drives gpg for real instead
// of reading verify.sh's source: the Chrome ceremony's Phase 4 was
// rehearsed end to end against the real CI-built extension zip, the
// manifest was signed with the TAG-signing key by way of a rehearsal,
// and verify.sh answered `ok - hashes match, header anchors to v0.336.0,
// GPG signature is good`. Nothing in the output hinted that the key was
// wrong, because nothing had looked. A source-reading test would have
// been satisfied by the string `gpg --verify` the whole time, which is
// exactly what release-tools.smoke.js asserted and why it stayed green.
//
// So: generate two throwaway keys, sign a manifest with one, and require
// verify.sh to accept it under that key's fingerprint and refuse it
// under the other's. The second key is given a certify-only primary with
// a signing subkey, which is K1's real shape, because that is where an
// implementation slips: the fingerprint published on xchain.io/security
// is the primary's and the fingerprint gpg reports having verified with
// is the subkey's, so a naive comparison rejects the genuine release
// key and nothing else.

import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const VERIFY = join(root, 'tools', 'release', 'verify.sh');

if (spawnSync('gpg', ['--version'], { encoding: 'utf8' }).status !== 0) {
    // Loud, and a skip rather than a pass: this suite runs on machines
    // without gpg and the alternative (a source grep) is the check that
    // failed in the first place.
    process.stderr.write('release-verify-signer.smoke.js: SKIPPED - gpg is not installed\n');
    process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'xc997-signer-'));
const gnupg = join(work, 'gnupg');
mkdirSync(gnupg, { mode: 0o700 });
const gpgEnv = { ...process.env, GNUPGHOME: gnupg };
const gpg = (...args) => execFileSync('gpg', ['--batch', '--quiet', ...args],
    { env: gpgEnv, encoding: 'utf8' });

const failures = [];
const check = (what, ok, detail = '') => {
    if (ok) return;
    failures.push(`${what}${detail ? `\n    ${detail.trim().split('\n').slice(-6).join('\n    ')}` : ''}`);
};

try {
    /* Key A: an ordinary sign-capable primary, standing for any other key
     * a maintainer happens to hold. */
    gpg('--passphrase', '', '--quick-generate-key',
        'XC997 Signer A <a@example.invalid>', 'ed25519', 'sign', '0');
    /* Key B: certify-only primary plus signing subkey, which is K1's shape. */
    gpg('--passphrase', '', '--quick-generate-key',
        'XC997 Signer B <b@example.invalid>', 'ed25519', 'cert', '0');

    const uidFpr = (uid) => {
        const colons = gpg('--list-keys', '--with-colons', uid);
        const lines = colons.split('\n');
        const primary = lines.find((l) => l.startsWith('fpr:'))?.split(':')[9];
        assert.ok(primary, `no primary fingerprint for ${uid}`);
        const subIdx = lines.findIndex((l) => l.startsWith('sub:'));
        const sub = subIdx === -1 ? null : lines[subIdx + 1]?.split(':')[9] ?? null;
        return { primary, sub };
    };

    const A = uidFpr('a@example.invalid');
    gpg('--passphrase', '', '--quick-add-key', uidFpr('b@example.invalid').primary,
        'ed25519', 'sign', '0');
    const B = uidFpr('b@example.invalid');
    check('key B has a signing subkey distinct from its primary',
        B.sub && B.sub !== B.primary, `primary=${B.primary} sub=${B.sub}`);

    /* A manifest with the header verify.sh requires. Hashes are checked
     * against the artifact beside it, so both are written for real; the
     * subject here is the signature, not the hashing, which
     * release-tools.smoke.js already drives. */
    const dir = join(work, 'release');
    mkdirSync(dir);
    const artifact = 'xchain-wallet-extension-v9.9.9.zip';
    writeFileSync(join(dir, artifact), 'not a real zip, hashed like one\n');
    const sha = execFileSync('shasum', ['-a', '256', artifact],
        { cwd: dir, encoding: 'utf8' }).split(/\s+/)[0];
    const manifest = join(dir, 'RELEASE_HASHES.txt');
    writeFileSync(manifest, [
        '# XChain Wallet release manifest',
        '# manifest-version: 2',
        '# tag: v9.9.9',
        '# tag-commit: 0000000000000000000000000000000000000000',
        '# built: 2026-01-01T00:00:00Z',
        '# dev-mock-gate: enforced',
        '# artifacts: 1',
        `# profile default: ./${artifact}`,
        `${sha}  ./${artifact}`,
        '',
    ].join('\n'));
    gpg('--yes', '--local-user', B.primary, '--armor', '--detach-sign',
        '--output', `${manifest}.asc`, manifest);

    const verify = (...args) => spawnSync('bash',
        [VERIFY, '--input', dir, '--tag', 'v9.9.9', ...args],
        { env: gpgEnv, encoding: 'utf8' });

    /* 1. The genuine case, named by the fingerprint a user reads on the
     * published channel: the PRIMARY, while the subkey made the
     * signature. */
    const good = verify('--key', B.primary);
    check('verify.sh accepts the signature under the signer\'s published primary fingerprint',
        good.status === 0, good.stderr);
    check('and says which key it bound to, rather than only that a signature was good',
        /signer ok - /.test(good.stderr), good.stderr);

    /* 2. The same signature named by the subkey that actually made it. */
    const bySub = verify('--key', B.sub);
    check('verify.sh accepts it under the signing subkey too', bySub.status === 0, bySub.stderr);

    /* 3. THE FINDING. A good signature from a key that is not the
     * expected one is a refusal, not an ok. */
    const wrong = verify('--key', A.primary);
    check('verify.sh REFUSES a good signature from a key that is not the expected one',
        wrong.status !== 0, wrong.stderr);
    check('and says the signature was good and the KEY was wrong, which is the whole diagnosis',
        /GOOD and it is from the WRONG KEY/.test(wrong.stderr), wrong.stderr);
    check('and prints both fingerprints, so the operator can tell which key they used',
        wrong.stderr.includes(A.primary) && wrong.stderr.includes(B.sub), wrong.stderr);

    /* 4. No expectation available is a refusal too. A check that cannot
     * run has not passed, and this one silently could not run for as long
     * as it existed. */
    const detached = join(work, 'detached', 'tools', 'release');
    mkdirSync(detached, { recursive: true });
    for (const f of ['verify.sh', 'lib.sh']) {
        writeFileSync(join(detached, f), execFileSync('cat', [join(root, 'tools', 'release', f)]));
    }
    const unbound = spawnSync('bash', [join(detached, 'verify.sh'), '--input', dir, '--tag', 'v9.9.9'], {
        env: { ...gpgEnv, XCHAIN_VERIFY_KEY: '' },
        encoding: 'utf8',
    });
    check('verify.sh refuses when no expected key can be resolved at all',
        unbound.status !== 0, unbound.stderr);

    /* 5. A short key id selects a key without identifying it, so it is
     * rejected as an argument rather than compared loosely. */
    const short = verify('--key', B.primary.slice(-8));
    check('verify.sh rejects a short key id in --key', short.status === 2, short.stderr);

    /* 6. Fingerprints get copied out of web pages and key listings with
     * the spacing and the case they were displayed in, so both are
     * normalised before comparison rather than treated as a mismatch. */
    const spaced = verify('--key', B.primary.toLowerCase().replace(/(.{4})/g, '$1 ').trim());
    check('verify.sh normalises a lowercase, space-grouped fingerprint',
        spaced.status === 0, spaced.stderr);

    /* 7. --no-sig is untouched: it never claimed to check a signature. */
    const nosig = verify('--no-sig');
    check('--no-sig still passes without any key expectation', nosig.status === 0, nosig.stderr);
} finally {
    /* gpg-agent holds a socket under GNUPGHOME and keeps the directory
     * busy if it is still running when the tree goes. */
    spawnSync('gpgconf', ['--kill', 'gpg-agent'], { env: gpgEnv });
    rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
    console.error(`FAIL release-verify-signer.smoke.js: ${failures.length} check(s) failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}

console.log('PASS release-verify-signer.smoke.js ( S37: verify.sh binds the signature to an '
    + 'expected fingerprint, accepts the primary or the signing subkey, and refuses a good '
    + 'signature from any other key)');
