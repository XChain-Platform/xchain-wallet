// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { SOUND_PALETTE } from '../../packages/core/src/notifications/notificationSounds.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const expectedFiles = SOUND_PALETTE.map(({ id }) => `${id}.caf`).sort();
const soundDirectories = [
    'packages/mobile/ios/App/App/sounds',
    'packages/mobile/ios/App/WatchApp/sounds',
];
const execFileAsync = promisify(execFile);

test('converter passes every MP3 directly to afconvert for both destinations', async (t) => {
    const temporaryRoot = await mkdtemp(join(repoRoot, 'tmp/convert-sounds-test-'));
    t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

    const scriptDirectory = join(temporaryRoot, 'tools/watch');
    const sourceDirectory = join(temporaryRoot, 'packages/web/public/sounds');
    const mockBin = join(temporaryRoot, 'bin');
    const logFile = join(temporaryRoot, 'afconvert.log');
    await Promise.all([
        mkdir(scriptDirectory, { recursive: true }),
        mkdir(sourceDirectory, { recursive: true }),
        mkdir(mockBin, { recursive: true }),
    ]);

    const converter = join(scriptDirectory, 'convert-sounds.sh');
    await cp(join(repoRoot, 'tools/watch/convert-sounds.sh'), converter);
    await Promise.all(SOUND_PALETTE.map(({ file }) => writeFile(join(sourceDirectory, file), 'mp3')));

    const mockAfconvert = join(mockBin, 'afconvert');
    await writeFile(mockAfconvert, `#!/bin/bash
set -euo pipefail
[[ "$#" -eq 6 && "$1" == -f && "$2" == caff && "$3" == -d && "$4" == LEI16 && "$5" == *.mp3 && "$6" == *.caf ]]
printf '%s\\t%s\\n' "$5" "$6" >> "$AFCONVERT_LOG"
printf caff > "$6"
`);
    await chmod(mockAfconvert, 0o755);

    await execFileAsync('/bin/bash', [converter], {
        env: {
            ...process.env,
            AFCONVERT_LOG: logFile,
            PATH: `${mockBin}:/usr/bin:/bin`,
        },
    });

    const calls = (await readFile(logFile, 'utf8')).trim().split('\n').map((line) => line.split('\t'));
    const expectedCalls = SOUND_PALETTE.flatMap(({ id, file }) => soundDirectories.map((directory) => [
        join(sourceDirectory, file),
        join(temporaryRoot, directory, `${id}.caf`),
    ])).sort();
    assert.deepEqual(calls.sort(), expectedCalls);

    const script = await readFile(converter, 'utf8');
    assert.doesNotMatch(script, /\bffmpeg\b/);
});

for (const relativeDirectory of soundDirectories) {
    test(`${relativeDirectory} contains exactly the notification sound palette`, async () => {
        const directory = `${repoRoot}/${relativeDirectory}`;
        const entries = await readdir(directory, { withFileTypes: true });

        assert.deepEqual(entries.map(({ name }) => name).sort(), expectedFiles);
        assert.ok(entries.every((entry) => entry.isFile()), 'sound directory must contain only files');

        for (const fileName of expectedFiles) {
            const contents = await readFile(`${directory}/${fileName}`);
            assert.equal(contents.subarray(0, 4).toString('ascii'), 'caff', `${fileName} must be a CAF file`);
        }
    });
}
