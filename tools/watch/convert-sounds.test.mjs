// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SOUND_PALETTE } from '../../packages/core/src/notifications/notificationSounds.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const expectedFiles = SOUND_PALETTE.map(({ id }) => `${id}.caf`).sort();
const soundDirectories = [
    'packages/mobile/ios/App/App/sounds',
    'packages/mobile/ios/App/WatchApp/sounds',
];

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
