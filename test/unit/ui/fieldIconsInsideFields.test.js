// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { cachedSourceFiles } from '../../helpers/sourceScan.js';

describe('field icon placement', () => {
    it('keeps the removed label action API out of package sources', () => {
        const offenders = cachedSourceFiles('packages', '**/*.{js,jsx,ts,tsx,css}')
            .filter(({ source }) => source.includes('labelAction'))
            .map(({ relativePath }) => relativePath);

        expect(offenders).toEqual([]);
    });
});
