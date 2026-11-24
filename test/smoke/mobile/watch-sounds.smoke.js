// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { SOUND_PALETTE } from '../../../packages/core/src/notifications/notificationSounds.js';

const root = new URL('../../../', import.meta.url);
const rootPath = fileURLToPath(root);
const expectedFiles = SOUND_PALETTE.map(({ id }) => `${id}.caf`).sort();
const soundDirectories = [
    'packages/mobile/ios/App/App/sounds/',
    'packages/mobile/ios/App/WatchApp/sounds/',
];
const execFileAsync = promisify(execFile);

async function soundDigests(temporaryRoot) {
    return Object.fromEntries(await Promise.all(soundDirectories.flatMap((directory) =>
        expectedFiles.map(async (fileName) => {
            const contents = await readFile(join(temporaryRoot, directory, fileName));
            assert.equal(contents.subarray(0, 4).toString('ascii'), 'caff');
            return [`${directory}${fileName}`, createHash('sha256').update(contents).digest('hex')];
        }))));
}

const temporaryRoot = await mkdtemp(join(rootPath, 'tmp/watch-sounds-smoke-'));
try {
    const converterDirectory = join(temporaryRoot, 'tools/watch');
    const sourceDirectory = join(temporaryRoot, 'packages/web/public/sounds');
    const mockBin = join(temporaryRoot, 'bin');
    const decodeLog = join(temporaryRoot, 'mpg123.log');
    await Promise.all([
        mkdir(converterDirectory, { recursive: true }),
        mkdir(sourceDirectory, { recursive: true }),
        mkdir(mockBin, { recursive: true }),
    ]);

    const converter = join(converterDirectory, 'convert-sounds.sh');
    await cp(join(rootPath, 'tools/watch/convert-sounds.sh'), converter);
    await Promise.all(SOUND_PALETTE.map(({ file }) =>
        cp(join(rootPath, 'packages/web/public/sounds', file), join(sourceDirectory, file))));

    const whichResult = await execFileAsync('/usr/bin/which', ['mpg123']);
    const realMpg123 = (typeof whichResult === 'string' ? whichResult : whichResult.stdout).trim();
    const mpg123Wrapper = join(mockBin, 'mpg123');
    await writeFile(mpg123Wrapper, `#!/bin/bash
set -euo pipefail
printf '%s\\t%s\\t%s\\t%s\\n' "$1" "$2" "$3" "$4" >> "$MPG123_LOG"
exec "$REAL_MPG123" "$@"
`);
    await chmod(mpg123Wrapper, 0o755);

    const environment = {
        ...process.env,
        MPG123_LOG: decodeLog,
        PATH: `${mockBin}:/usr/bin:/bin:${dirname(realMpg123)}`,
        REAL_MPG123: realMpg123,
    };
    await execFileAsync('/bin/bash', [converter], { env: environment });
    const firstDigests = await soundDigests(temporaryRoot);
    await execFileAsync('/bin/bash', [converter], { env: environment });
    assert.deepEqual(await soundDigests(temporaryRoot), firstDigests);

    const decodeCalls = (await readFile(decodeLog, 'utf8')).trim().split('\n');
    assert.equal(decodeCalls.length, expectedFiles.length * 2);
    const sourceCounts = new Map();
    for (const call of decodeCalls) {
        const [quiet, wav, pcm, source] = call.split('\t');
        assert.equal(quiet, '--quiet');
        assert.equal(wav, '--wav');
        assert.equal(basename(pcm), basename(source, '.mp3') + '.wav');
        sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    }
    for (const { file } of SOUND_PALETTE) {
        assert.equal(sourceCounts.get(join(sourceDirectory, file)), 2);
    }
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}

for (const directory of soundDirectories) {
    const directoryUrl = new URL(directory, root);
    assert.deepEqual(
        (await readdir(directoryUrl)).sort(),
        expectedFiles,
        `${directory} must exactly match SOUND_PALETTE`,
    );

    for (const fileName of expectedFiles) {
        const contents = await readFile(new URL(fileName, directoryUrl));
        assert.equal(
            contents.subarray(0, 4).toString('ascii'),
            'caff',
            `${directory}${fileName} must be a CAF file`,
        );
    }
}

console.log(`watch sounds smoke OK (${expectedFiles.length} sounds in both bundles)`);
