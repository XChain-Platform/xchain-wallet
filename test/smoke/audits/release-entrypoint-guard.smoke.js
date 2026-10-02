// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Run the release tools from a symlinked and a spaced checkout path, where a bare
// `file://${argv[1]}` entry guard is false and the CLI silently exits 0, and check
// that verify-store.sh refuses a manifest step that compared nothing.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const releaseDir = join(here, '..', '..', '..', 'tools', 'release');
const work = mkdtempSync(join(tmpdir(), 'release-entry guard-'));

const node = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

try {
    const differA = join(work, 'a.json');
    const differB = join(work, 'b.json');
    const sameB = join(work, 'same.json');
    writeFileSync(differA, '{"name":"x","version":"1.0.0"}');
    writeFileSync(differB, '{"name":"x","version":"1.0.1"}');
    writeFileSync(sameB, '{"name":"x","version":"1.0.0","key":"K","update_url":"U"}');

    // Reach the same release directory through a symlink, and a copy of manifest-diff through a spaced path.
    const link = join(work, 'rel-link');
    symlinkSync(releaseDir, link);
    const spaced = join(work, 'dir with space');
    mkdirSync(spaced);
    copyFileSync(join(releaseDir, 'manifest-diff.mjs'), join(spaced, 'manifest-diff.mjs'));

    for (const script of [join(link, 'manifest-diff.mjs'), join(spaced, 'manifest-diff.mjs')]) {
        const differ = node(script, [differA, differB]);
        assert.equal(differ.status, 1,
            `manifest-diff via ${script} exited ${differ.status} on differing manifests; a silent 0 means `
            + 'its entry guard skipped the CLI and compared nothing.');
        assert.match(differ.stderr, /version/);
        const same = node(script, [differA, sameB]);
        assert.equal(same.status, 0, same.stderr);
        assert.match(same.stdout, /manifest-diff: ok/);
    }

    // A pin path that does not exist is exit 3; a skipped CLI would exit 0 having said nothing.
    const phase4 = node(join(link, 'phase4-rehearsal.mjs'), ['check', '--pin', join(work, 'no-pin.json')]);
    assert.equal(phase4.status, 3,
        `phase4-rehearsal check via a symlink exited ${phase4.status}; its entry guard skipped the CLI.`);

    // Drive verify-store.sh end to end through the symlink with a store manifest that differs.
    const haveZip = spawnSync('zip', ['-v'], { encoding: 'utf8' }).status === 0
        && spawnSync('unzip', ['-v'], { encoding: 'utf8' }).status === 0;
    if (haveZip) {
        const src = join(work, 'src');
        const input = join(work, 'in');
        const store = join(work, 'store');
        for (const d of [src, input, store]) mkdirSync(d);
        writeFileSync(join(src, 'manifest.json'), '{"name":"x","version":"1.0.0"}');
        writeFileSync(join(src, 'a.js'), 'hi\n');
        const z = spawnSync('zip', ['-qr', join(input, 'ext.zip'), '.'], { cwd: src, encoding: 'utf8' });
        assert.equal(z.status, 0, z.stderr);
        const recompute = spawnSync('bash', [join(link, 'verify.sh'), '--input', input, '--recompute'],
            { encoding: 'utf8' });
        assert.equal(recompute.status, 0, recompute.stderr);
        for (const f of readdirSync(src)) copyFileSync(join(src, f), join(store, f));
        const verifyStore = () => spawnSync('bash', [join(link, 'verify-store.sh'), '--input', input,
            '--zip-name', 'ext.zip', '--no-sig', '--unpacked-dir', store], { encoding: 'utf8' });

        const match = verifyStore();
        assert.equal(match.status, 0, match.stderr);
        assert.match(match.stderr, /manifest-diff: ok/);

        writeFileSync(join(store, 'manifest.json'), '{"name":"x","version":"9.9.9"}');
        const differ = verifyStore();
        assert.equal(differ.status, 1,
            'verify-store.sh passed a store manifest that differs from the reference build when run '
            + `through a symlinked checkout; stderr: ${differ.stderr.slice(-400)}`);
    } else {
        console.log('note: zip/unzip not on this host; the verify-store.sh end-to-end case did not run');
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

console.log('release-entrypoint-guard.smoke.js: ok');
