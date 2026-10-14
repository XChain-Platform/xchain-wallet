// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
    findRawTokenColorViolations,
    normalizeColor,
    readSharedCssSources,
} from '../../helpers/sharedCssColorTokens.js';

describe('shared CSS color-token audit', () => {
    it('normalizes equivalent hex and rgb spellings', () => {
        expect(normalizeColor('#fff')).toBe('#ffffff');
        expect(normalizeColor('rgba( 20, 111, 52, 0.10 )')).toBe('rgba(20,111,52,0.1)');
    });

    it('flags direct duplicates but permits token fallbacks and documented fixed colors', () => {
        const tokens = ':root { --xc-on-accent: #FFFFFF; }';
        const files = [{
            path: 'Fixture.module.css',
            source: [
                '.bad { color: #fff; }',
                '.fallback { color: var(--xc-on-accent, #fff); }',
                '/* raw-color-ok: fixed white preserves artwork contrast. */',
                '.fixed { background: #FFFFFF; }',
            ].join('\n'),
        }];

        expect(findRawTokenColorViolations(tokens, files)).toEqual([
            { path: 'Fixture.module.css', line: 1, color: '#ffffff' },
        ]);
    });

    it('keeps the shared CSS tree free of undocumented token duplicates', () => {
        const tokens = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
        const files = readSharedCssSources(process.cwd());
        expect(findRawTokenColorViolations(tokens, files)).toEqual([]);
    });
});
