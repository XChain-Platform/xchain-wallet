// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';

import {
    PLAY_VERSION_CODE_CEILING,
    WEAR_VERSION_CODE_OFFSET,
    versionCodeFromTag,
    wearVersionCodeFromTag,
} from '../../../packages/mobile/scripts/version.js';

describe('wearVersionCodeFromTag', () => {
    it("keeps the largest Wear release under Play's ceiling", () => {
        const tag = 'v109.999.99-respin.49';

        expect(WEAR_VERSION_CODE_OFFSET).toBe(1_000_000_000);
        expect(wearVersionCodeFromTag(tag)).toBe(
            versionCodeFromTag(tag) + WEAR_VERSION_CODE_OFFSET,
        );
        expect(wearVersionCodeFromTag(tag)).toBe(2_099_999_999);
        expect(wearVersionCodeFromTag(tag)).toBeLessThan(PLAY_VERSION_CODE_CEILING);
    });

    it('refuses a release that would cross the Wear versionCode bound', () => {
        expect(() => wearVersionCodeFromTag('v110.0.0')).toThrow(/MAJOR 110 exceeds 109/);
    });
});
