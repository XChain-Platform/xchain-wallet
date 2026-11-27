// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { main } from './play-upload-check.mjs';

const phone = 'xchain-wallet-android-v9.8.7.aab';
const wear = 'xchain-wallet-wear-v9.8.7.aab';

async function staged(t, { provenance = 'tag:  v9.8.7\nrehearsal:  no\n', files = {} } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'play-upload-check-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    if (provenance !== null) {
        await mkdir(join(dir, 'records'));
        await writeFile(join(dir, 'records', 'PROVENANCE.txt'), provenance);
    }
    for (const [name, contents] of Object.entries(files)) await writeFile(join(dir, name), contents);
    return dir;
}

async function run(argv) {
    let stdout = '';
    let stderr = '';
    const code = await main(argv, {
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: (text) => { stderr += text; } },
    });
    return { code, stdout, stderr };
}

async function sha256(path) {
    return createHash('sha256').update(await readFile(path)).digest('hex');
}

test('prints exactly the phone and Wear bundles in that order with their hashes', async (t) => {
    const dir = await staged(t, { files: { [phone]: 'phone', [wear]: 'wear', 'xchain-wallet-v9.8.7.apk': 'apk' } });
    const result = await run([dir]);
    assert.deepEqual(result, {
        code: 0,
        stdout: `upload ${phone} 5 sha256:${await sha256(join(dir, phone))}\n`
            + `upload ${wear} 4 sha256:${await sha256(join(dir, wear))}\n`,
        stderr: '',
    });
});

test('marks a bundle above the Chrome tool cap for dragging', async (t) => {
    const dir = await staged(t, { files: { [phone]: 'phone', [wear]: '' } });
    await truncate(join(dir, wear), 10_000_001);
    const result = await run([dir]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, new RegExp(`^upload ${phone} 5 sha256:[a-f0-9]{64}\\ndrag ${wear} 10000001 sha256:[a-f0-9]{64}\\n$`));
    assert.equal(result.stderr, '');
});

for (const [label, options, named] of [
    ['rehearsal', { provenance: 'tag:  v9.8.7\nrehearsal:  yes\n', files: { [phone]: '', [wear]: '' } }, 'rehearsal'],
    ['missing record', { provenance: null, files: { [phone]: '', [wear]: '' } }, 'PROVENANCE.txt'],
    ['missing Wear bundle', { files: { [phone]: '' } }, wear],
]) {
    test(`${label} prints exactly one problem`, async (t) => {
        const result = await run([await staged(t, options)]);
        assert.equal(result.code, 1);
        assert.equal(result.stdout.trim().split('\n').length, 1);
        assert.match(result.stdout, new RegExp(`^problem: .*${named.replace('.', '\\.')}.*\\n$`));
        assert.equal(result.stderr, '');
    });
}

for (const [label, files, named] of [
    ['wrong Wear version', { [phone]: '', 'xchain-wallet-wear-v9.8.6.aab': '' }, 'xchain-wallet-wear-v9.8.6.aab'],
    ['stray bundle', { [phone]: '', [wear]: '', 'extra.aab': '' }, 'extra.aab'],
]) {
    test(`${label} is refused by name`, async (t) => {
        const result = await run([await staged(t, { files })]);
        assert.equal(result.code, 1);
        assert.match(result.stdout, new RegExp(`^problem: .*${named.replaceAll('.', '\\.')}.*$`, 'm'));
        assert.equal(result.stderr, '');
    });
}

test('--help and -h print usage to stdout, exit 0 and read nothing', async () => {
    for (const flag of ['--help', '-h']) {
        let reads = 0;
        const result = { stdout: '', stderr: '' };
        const code = await main([flag], {
            readDir: async () => { reads += 1; return []; },
            stdout: { write: (text) => { result.stdout += text; } },
            stderr: { write: (text) => { result.stderr += text; } },
        });
        assert.equal(code, 0);
        assert.equal(reads, 0);
        assert.match(result.stdout, /^Usage: node tools\/release\/play-upload-check\.mjs <staged dir>\n\n/);
        assert.match(result.stdout, /PROVENANCE\.txt/);
        assert.equal(result.stderr, '');
    }
});

test('invalid argument shapes print usage and read nothing', async () => {
    for (const argv of [[], ['one', 'two'], ['--lane']]) {
        let reads = 0;
        let stderr = '';
        const code = await main(argv, {
            readDir: async () => { reads += 1; return []; },
            stderr: { write: (text) => { stderr += text; } },
        });
        assert.equal(code, 2);
        assert.equal(reads, 0);
        assert.equal(stderr, 'Usage: node tools/release/play-upload-check.mjs <staged dir>\n');
    }
});
