// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// verify.sh must read the caller's manifest path once. A shim sha256sum
// rewrites the manifest and its signature on disk after the hash check
// starts; a shim gpg records the bytes it was handed. The run has to anchor
// on the original header and hand gpg a copy of the original bytes, never
// the caller's path.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const VERIFY = join(root, 'tools', 'release', 'verify.sh');

const work = mkdtempSync(join(tmpdir(), 'verify-snapshot-'));
const failures = [];
const check = (what, ok, detail = '') => {
    if (!ok) failures.push(`${what}${detail ? `\n    ${detail.trim().split('\n').slice(-6).join('\n    ')}` : ''}`);
};

try {
    const realShasum = spawnSync('bash', ['-c', 'command -v shasum || command -v sha256sum'],
        { encoding: 'utf8' }).stdout.trim();
    assert.ok(realShasum, 'no shasum or sha256sum on this machine');
    const realArgs = realShasum.endsWith('shasum') ? '-a 256' : '';

    const dir = join(work, 'release');
    const bin = join(work, 'bin');
    mkdirSync(dir);
    mkdirSync(bin);
    const artifact = 'xchain-wallet-extension-v9.9.9.zip';
    writeFileSync(join(dir, artifact), 'not a real zip, hashed like one\n');
    const sha = spawnSync(realShasum, [...realArgs.split(' ').filter(Boolean), artifact],
        { cwd: dir, encoding: 'utf8' }).stdout.split(/\s+/)[0];

    const fpr = 'AB'.repeat(20);
    const header = (tag) => [
        '# XChain Wallet release manifest',
        '# manifest-version: 2',
        `# tag: ${tag}`,
        '# tag-commit: 0000000000000000000000000000000000000000',
        '# built: 2026-01-01T00:00:00Z',
        '# dev-mock-gate: enforced',
        '# artifacts: 1',
        `# profile default: ./${artifact}`,
        `${sha}  ./${artifact}`,
        '',
    ].join('\n');
    const original = header('v9.9.9');
    const swapped = header('v1.0.0');
    const manifest = join(dir, 'RELEASE_HASHES.txt');
    writeFileSync(manifest, original);
    writeFileSync(`${manifest}.asc`, 'original signature bytes\n');

    const seen = join(work, 'gpg-saw');
    mkdirSync(seen);
    const shaShim = join(bin, 'sha256sum');
    writeFileSync(shaShim, [
        '#!/usr/bin/env bash',
        `printf '%s' '${swapped.replace(/'/g, "'\\''")}' > "${manifest}"`,
        `printf 'swapped signature bytes\\n' > "${manifest}.asc"`,
        `exec "${realShasum}" ${realArgs} "$@"`,
        '',
    ].join('\n'));
    const gpgShim = join(bin, 'gpg');
    writeFileSync(gpgShim, [
        '#!/usr/bin/env bash',
        'sig="${@: -2:1}"; man="${@: -1}"',
        `printf '%s' "$man" > "${seen}/manifest-path"`,
        `cat "$man" > "${seen}/manifest-bytes"`,
        `cat "$sig" > "${seen}/sig-bytes"`,
        `echo "[GNUPG:] VALIDSIG ${fpr} 2026-01-01 0 4 0 22 8 00 ${fpr}" >&3`,
        '',
    ].join('\n'));
    chmodSync(shaShim, 0o755);
    chmodSync(gpgShim, 0o755);

    const res = spawnSync('bash', [VERIFY, '--input', dir, '--tag', 'v9.9.9', '--key', fpr], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        encoding: 'utf8',
    });

    check('verify.sh anchors on the header it read first, not the rewritten file',
        res.status === 0, res.stderr);
    check('and says the header anchors to the original tag',
        /header anchor ok - manifest describes v9\.9\.9/.test(res.stderr), res.stderr);
    check('the caller path was rewritten during the run (the shim ran)',
        readFileSync(manifest, 'utf8') === swapped);
    const readSeen = (f) => { try { return readFileSync(join(seen, f), 'utf8'); } catch { return null; } };
    check('gpg was handed the original manifest bytes', readSeen('manifest-bytes') === original,
        String(readSeen('manifest-bytes')));
    check('gpg was handed the original signature bytes',
        readSeen('sig-bytes') === 'original signature bytes\n', String(readSeen('sig-bytes')));
    check('gpg was not pointed at the caller path', readSeen('manifest-path') !== manifest,
        String(readSeen('manifest-path')));
    check('the snapshot keeps the published basename for the filename anchor',
        (readSeen('manifest-path') ?? '').endsWith('/RELEASE_HASHES.txt'));
    const snapDir = dirname(readSeen('manifest-path') ?? '');
    check('the snapshot directory is removed on exit',
        snapDir !== '.' && spawnSync('test', ['-e', snapDir]).status !== 0, snapDir);
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
    console.error(`FAIL release-verify-snapshot.smoke.js: ${failures.length} check(s) failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}

console.log('PASS release-verify-snapshot.smoke.js (verify.sh snapshots the manifest and '
    + 'signature once and reads only the copy)');
