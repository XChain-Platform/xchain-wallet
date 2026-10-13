// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    findUncoveredMotionCss,
    hasGlobalReducedMotionGuard,
    runReducedMotionAudit,
} from '../../../packages/core/scripts/reduced-motion-audit.js';

const guardedTokens = `
    @media (prefers-reduced-motion: reduce) {
        :root:not([data-xc-reduced-motion="no-preference"]) {
            --xc-transition: 0ms;
        }
        :root:not([data-xc-reduced-motion="no-preference"]),
        :root:not([data-xc-reduced-motion="no-preference"]) *,
        :root:not([data-xc-reduced-motion="no-preference"]) *::before,
        :root:not([data-xc-reduced-motion="no-preference"]) *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
        }
    }
`;

describe('reduced-motion CSS audit', () => {
    it('recognizes the global OS guard and the explicit opt-out', () => {
        expect(hasGlobalReducedMotionGuard(guardedTokens)).toBe(true);
        expect(hasGlobalReducedMotionGuard(guardedTokens.replace(' *::after', ' .missing'))).toBe(false);
    });

    it('lists hard-coded motion when the global guard is absent', () => {
        const stylesheets = [
            { file: 'HardCoded.module.css', source: '.item { transition: color 120ms ease; }' },
            { file: 'Animated.module.css', source: '.item { animation: pulse 1s infinite; }' },
        ];
        expect(findUncoveredMotionCss(stylesheets, '')).toEqual([
            { file: 'HardCoded.module.css', kinds: ['transition'] },
            { file: 'Animated.module.css', kinds: ['animation'] },
        ]);
    });

    it('accepts local overrides, token reduction, and essential allowlist entries', () => {
        const stylesheets = [
            {
                file: 'Local.module.css',
                source: '.a { animation: pulse 1s infinite; }\n'
                    + '@media (prefers-reduced-motion: reduce) { .a { animation: none; } }',
            },
            { file: 'Token.module.css', source: '.b { transition: color var(--xc-transition); }' },
            { file: 'Essential.module.css', source: '.c { animation: status 1s infinite; }' },
        ];
        const tokenOnly = '@media (prefers-reduced-motion: reduce) { :root { --xc-transition: 0ms; } }';
        const allowlist = new Map([['Essential.module.css', 'Communicates an essential status.']]);
        expect(findUncoveredMotionCss(stylesheets, tokenOnly, allowlist)).toEqual([]);
    });

    it('finds no uncovered motion in core source', () => {
        expect(runReducedMotionAudit().uncovered).toEqual([]);
    });
});
