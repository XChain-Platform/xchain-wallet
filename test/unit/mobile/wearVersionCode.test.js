// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    PLAY_VERSION_CODE_CEILING,
    versionCodeFromTag,
    versionPropertiesFor,
    wearVersionCodeFromTag,
} from '../../../packages/mobile/scripts/version.js';

describe('Wear versionCode', () => {
    it('adds the reserved offset to the phone versionCode', () => {
        expect(wearVersionCodeFromTag('v0.333.1'))
            .toBe(versionCodeFromTag('v0.333.1') + 1_000_000_000);
    });

    it("keeps the largest Wear release under Play's ceiling", () => {
        expect(wearVersionCodeFromTag('v109.999.99-respin.49'))
            .toBe(PLAY_VERSION_CODE_CEILING - 1);
    });

    it('writes the code for the Wear Gradle module to consume', () => {
        const properties = versionPropertiesFor('v0.333.1');
        const gradle = readFileSync(
            join(process.cwd(), 'packages/mobile/android/wear/build.gradle'),
            'utf8',
        );

        expect(properties).toContain('wearVersionCode=1003330150');
        expect(gradle).toContain("versionCode versionProps['wearVersionCode'].toInteger()");
        expect(gradle).not.toMatch(/versionCode\s+1\b/);
    });
});
