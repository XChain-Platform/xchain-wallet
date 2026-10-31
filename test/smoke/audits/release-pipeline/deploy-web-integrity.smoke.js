// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync,
    rmSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const deployScript = join(root, 'tools', 'release', 'deploy-web.sh');
const work = mkdtempSync(join(tmpdir(), 'deploy-web-integrity-'));

function artifact(tag, rootMtime) {
    const dir = join(work, `artifact-${tag}`);
    const source = join(dir, 'source');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'index.html'), `<html>${tag}</html>\n`);
    utimesSync(source, rootMtime, rootMtime);
    const tarball = join(dir, `xchain-wallet-web-${tag}.tar.gz`);
    execFileSync('tar', ['-czf', tarball, '-C', source, '.']);
    const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex');
    const manifest = join(dir, `${tag}.txt`);
    writeFileSync(manifest, [
        '# XChain Wallet release manifest',
        '# manifest-version: 2',
        `# tag: ${tag}`,
        '# tag-commit: 0000000000000000000000000000000000000000',
        '# built: 2026-01-01T00:00:00Z',
        '# dev-mock-gate: enforced',
        '# artifacts: 1',
        `# profile default: ./${tarball.split('/').pop()}`,
        `${digest}  ./${tarball.split('/').pop()}`,
        '',
    ].join('\n'));
    return { manifest, tag, tarball };
}

function deploy({ item, webroot, cwd = root, keep = 5, env = process.env }) {
    return spawnSync('bash', [
        deployScript,
        '--tarball', item.tarball,
        '--manifest', item.manifest,
        '--tag', item.tag,
        '--webroot', webroot,
        '--keep', String(keep),
        '--no-sig',
    ], { cwd, encoding: 'utf8', env });
}

function seedRelease(webroot, tag, ageSeconds) {
    const dir = join(webroot, 'releases', tag);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), `<html>${tag}</html>\n`);
    const then = (Date.now() / 1000) - ageSeconds;
    utimesSync(dir, then, then);
}

try {
    const relativeCwd = join(work, 'relative');
    mkdirSync(relativeCwd);
    const relative = deploy({
        item: artifact('v1.0.0', 1),
        webroot: 'site',
        cwd: relativeCwd,
    });
    assert.equal(relative.status, 0, relative.stderr);
    const relativeRoot = join(relativeCwd, 'site');
    assert.equal(readlinkSync(join(relativeRoot, 'current')), 'releases/v1.0.0');
    assert.equal(readFileSync(join(relativeRoot, 'current', 'index.html'), 'utf8'), '<html>v1.0.0</html>\n');

    const shimDir = join(work, 'shim');
    mkdirSync(shimDir);
    const shim = join(shimDir, 'ln');
    writeFileSync(shim, [
        '#!/usr/bin/env bash',
        'if [[ ! -e "$BREAK_ONCE" ]]; then',
        '    : > "$BREAK_ONCE"',
        '    exec /bin/ln -sfn missing "${!#}"',
        'fi',
        'exec /bin/ln "$@"',
        '',
    ].join('\n'));
    chmodSync(shim, 0o755);
    const guardedRoot = join(work, 'guarded');
    mkdirSync(join(guardedRoot, 'releases'), { recursive: true });
    seedRelease(guardedRoot, 'v1.9.0', 100);
    symlinkSync('releases/v1.9.0', join(guardedRoot, 'current'));
    const guarded = deploy({
        item: artifact('v2.0.0', 1),
        webroot: guardedRoot,
        env: {
            ...process.env,
            BREAK_ONCE: join(work, 'break-once'),
            PATH: `${shimDir}:${process.env.PATH}`,
        },
    });
    assert.notEqual(guarded.status, 0, guarded.stderr);
    assert.match(guarded.stderr, /does not reach index\.html/);
    assert.doesNotMatch(guarded.stderr, /live on v2\.0\.0/);
    assert.equal(readlinkSync(join(guardedRoot, 'current')), 'releases/v1.9.0');
    assert.equal(readFileSync(join(guardedRoot, 'current', 'index.html'), 'utf8'), '<html>v1.9.0</html>\n');

    const orderedRoot = join(work, 'ordered');
    mkdirSync(join(orderedRoot, 'releases'), { recursive: true });
    seedRelease(orderedRoot, 'v3.0.0', 300);
    seedRelease(orderedRoot, 'v3.1.0', 200);
    seedRelease(orderedRoot, 'v3.2.0', 100);
    symlinkSync('releases/v3.2.0', join(orderedRoot, 'current'));
    const ordered = deploy({
        item: artifact('v3.3.0', 1),
        webroot: orderedRoot,
        keep: 2,
    });
    assert.equal(ordered.status, 0, ordered.stderr);
    assert.deepEqual(
        readdirSync(join(orderedRoot, 'releases')).sort(),
        ['v3.2.0', 'v3.3.0'],
        'retention must use deployment time instead of the archive root mtime',
    );
} finally {
    rmSync(work, { recursive: true, force: true });
}

console.log('PASS deploy-web-integrity.smoke.js');
