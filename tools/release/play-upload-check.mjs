// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { isInvokedDirectly } from './is-invoked-directly.mjs';

const USAGE = 'Usage: node tools/release/play-upload-check.mjs <staged dir>\n';
const HELP = `${USAGE}
Checks a staged Android release directory before the Play Console upload.
It reads records/PROVENANCE.txt (a real tag, rehearsal: no) and expects exactly
xchain-wallet-android-v<version>.aab and xchain-wallet-wear-v<version>.aab.
Each bundle prints as "upload <name> <bytes> sha256:<hash>", or "drag ..." when
it is above 10 MB and must be dragged into the console by hand.
Exits 0 when the set is ready, 1 with one "problem:" line each, 2 on bad usage.
`;
const DRAG_LIMIT = 10_000_000;

async function streamedSha256(path) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
}

export function judgeStaged({ provenance, files }) {
    const problems = [];
    if (provenance === null) return { ok: false, uploads: [], problems: ['records/PROVENANCE.txt is missing'] };

    const tag = /^tag:\s*(\S+)\s*$/m.exec(provenance)?.[1];
    const rehearsal = /^rehearsal:\s*(\S+)\s*$/m.exec(provenance)?.[1];
    if (!tag) problems.push('records/PROVENANCE.txt has no tag: line');
    if (rehearsal !== 'no') problems.push('records/PROVENANCE.txt rehearsal: value is not no');
    if (!tag) return { ok: false, uploads: [], problems };

    const version = tag.replace(/^v/, '');
    const phoneName = `xchain-wallet-android-v${version}.aab`;
    const wearName = `xchain-wallet-wear-v${version}.aab`;
    const phone = files.filter(({ name }) => name === phoneName);
    const wear = files.filter(({ name }) => name === wearName);
    if (phone.length !== 1) problems.push(`expected exactly one ${phoneName}; found ${phone.length}`);
    if (wear.length !== 1) problems.push(`expected exactly one ${wearName}; found ${wear.length}`);

    for (const { name } of files.filter(({ name }) => name !== phoneName && name !== wearName)) {
        problems.push(`unexpected bundle ${name}`);
    }

    const uploads = [phone[0], wear[0]].filter(Boolean).map(({ name, bytes, sha256 }) => ({
        name,
        bytes,
        sha256,
        drag: bytes > DRAG_LIMIT,
    }));
    return { ok: problems.length === 0, uploads, problems };
}

export async function main(argv, {
    readDir = readdir,
    readFile: read = readFile,
    stat: getStat = stat,
    hashFile = streamedSha256,
    stdout = process.stdout,
    stderr = process.stderr,
} = {}) {
    if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
        stdout.write(HELP);
        return 0;
    }
    if (argv.length !== 1 || argv[0].startsWith('-')) {
        stderr.write(USAGE);
        return 2;
    }

    const staged = resolve(argv[0]);
    try {
        const names = await readDir(staged);
        let provenance = null;
        try {
            provenance = await read(join(staged, 'records', 'PROVENANCE.txt'), 'utf8');
        } catch {
            provenance = null;
        }
        const files = await Promise.all(names.filter((name) => name.endsWith('.aab')).sort().map(async (name) => {
            const path = join(staged, name);
            const [{ size: bytes }, sha256] = await Promise.all([getStat(path), hashFile(path)]);
            return { name, bytes, sha256 };
        }));
        const result = judgeStaged({ provenance, files });
        if (!result.ok) {
            for (const problem of result.problems) stdout.write(`problem: ${problem}\n`);
            return 1;
        }
        for (const upload of result.uploads) {
            stdout.write(`${upload.drag ? 'drag' : 'upload'} ${upload.name} ${upload.bytes} sha256:${upload.sha256}\n`);
        }
        return 0;
    } catch (error) {
        stderr.write(`error: ${error.message}\n`);
        return 2;
    }
}

if (isInvokedDirectly(import.meta.url)) {
    process.exitCode = await main(process.argv.slice(2));
}
