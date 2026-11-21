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
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { badVersionPins, readGradleExt } from './gradle-pins.mjs';

test('reads the current Android variables and accepts every version pin', () => {
    const text = readFileSync(new URL('../../packages/mobile/android/variables.gradle', import.meta.url), 'utf8');
    const vars = readGradleExt(text);

    assert.equal(vars.minSdkVersion, '26');
    assert.equal(vars.bouncyCastleVersion, '1.86');
    assert.deepEqual(badVersionPins(vars), []);
    assert.deepEqual(badVersionPins(vars, { prefix: 'androidx' }), []);
    assert.deepEqual(badVersionPins(vars, { prefix: 'cordova' }), []);
});

test('reports every refused wear version form in key order', () => {
    const vars = readGradleExt(`
        ext {
            wearAlphaVersion = '1.0-alpha'
            wearBetaVersion = "1.0-beta"
            wearRcVersion = '1.0-rc.1'
            wearSnapshotVersion = '1.0-SNAPSHOT'
            wearBuildVersion = '1.0+5'
            wearRangeVersion = '[1.0,2.0)'
            wearLatestVersion = 'latest.release'
            wearEmptyVersion = ''
            wearExactVersion = '1.2.3'
            phoneExactVersion = '2.0'
            // wearLineCommentVersion = '1.0-alpha'
            /* wearBlockCommentVersion = '1.0-beta' */
        }
    `);

    assert.deepEqual(badVersionPins(vars, { prefix: 'wear' }), [
        { key: 'wearAlphaVersion', value: '1.0-alpha' },
        { key: 'wearBetaVersion', value: '1.0-beta' },
        { key: 'wearRcVersion', value: '1.0-rc.1' },
        { key: 'wearSnapshotVersion', value: '1.0-SNAPSHOT' },
        { key: 'wearBuildVersion', value: '1.0+5' },
        { key: 'wearRangeVersion', value: '[1.0,2.0)' },
        { key: 'wearLatestVersion', value: 'latest.release' },
        { key: 'wearEmptyVersion', value: '' },
    ]);
    assert.deepEqual(badVersionPins(vars, { prefix: 'phone' }), []);
});
