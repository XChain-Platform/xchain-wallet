// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    findRawTransitionDurations,
    findUncoveredMotionCss,
    hasGlobalReducedMotionGuard,
    runReducedMotionAudit,
} from '../../../packages/core/scripts/reduced-motion-audit.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const animatedSurfaces = [
    'packages/core/src/shared/components/AlertsOverlay.module.css',
    'packages/core/src/shared/components/GatedFileViewer.module.css',
    'packages/core/src/shared/components/HeaderActionMenu.module.css',
    'packages/core/src/shared/components/NoticeModal.module.css',
    'packages/core/src/shared/components/ToastHost.module.css',
    'packages/core/src/shared/components/UndoSendToast.module.css',
    'packages/core/src/ui/Skeleton.module.css',
];
const transitionSurfaces = [
    'packages/core/src/shared/components/HomeTabs.module.css',
    'packages/core/src/ui/Button.module.css',
    'packages/core/src/ui/InfoTip.module.css',
    'packages/core/src/ui/Tabs.module.css',
];

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
    :root[data-xc-reduced-motion="reduce"],
    :root[data-xc-reduced-motion="reduce"] *,
    :root[data-xc-reduced-motion="reduce"] *::before,
    :root[data-xc-reduced-motion="reduce"] *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
    }
`;

describe('reduced-motion CSS audit', () => {
    it('flags raw transition durations outside tokens.css', () => {
        const stylesheets = [
            {
                file: 'packages/core/src/ui/tokens.css',
                source: ':root { --xc-motion-duration-fast: 120ms; }',
            },
            {
                file: 'Tokenized.module.css',
                source: '.a { transition: color var(--xc-transition); }',
            },
            {
                file: 'Raw.module.css',
                source: '.b { transition: opacity 120ms ease, transform 0.2s linear; }',
            },
            {
                file: 'Disabled.module.css',
                source: '.c { transition-duration: 0ms; }',
            },
        ];

        expect(findRawTransitionDurations(stylesheets)).toEqual([{
            file: 'Raw.module.css',
            value: 'opacity 120ms ease, transform 0.2s linear',
        }]);
    });

    it('keeps audited surface animation timing tokenized for both preference sources', () => {
        for (const file of animatedSurfaces) {
            const source = readFileSync(join(repoRoot, file), 'utf8');
            expect(source, file).toMatch(/animation:[^;]+var\(--xc-motion-duration-/);
            expect(source, file).toContain("data-xc-reduced-motion='no-preference'");
            expect(source, file).toContain("data-xc-reduced-motion='reduce'");
        }
    });

    it('keeps button, popover, and tab transitions free of raw durations', () => {
        const stylesheets = transitionSurfaces.map((file) => ({
            file,
            source: readFileSync(join(repoRoot, file), 'utf8'),
        }));
        expect(findRawTransitionDurations(stylesheets)).toEqual([]);
    });

    it('requires both the global OS guard and the app setting guard', () => {
        expect(hasGlobalReducedMotionGuard(guardedTokens)).toBe(true);
        expect(hasGlobalReducedMotionGuard(guardedTokens.replace(' *::after', ' .missing'))).toBe(false);
        expect(hasGlobalReducedMotionGuard(guardedTokens.replace(
            /:root\[data-xc-reduced-motion="reduce"\],[\s\S]*$/,
            '',
        ))).toBe(false);
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
                    + '@media (prefers-reduced-motion: reduce) { .a { animation: none; } }\n'
                    + ':root[data-xc-reduced-motion="reduce"] .a { animation: none; }',
            },
            { file: 'Token.module.css', source: '.b { transition: color var(--xc-transition); }' },
            { file: 'Essential.module.css', source: '.c { animation: status 1s infinite; }' },
        ];
        const tokenOnly = '@media (prefers-reduced-motion: reduce) { :root { --xc-transition: 0ms; } }\n'
            + ':root[data-xc-reduced-motion="reduce"] { --xc-transition: 0ms; }';
        const allowlist = new Map([['Essential.module.css', 'Communicates an essential status.']]);
        expect(findUncoveredMotionCss(stylesheets, tokenOnly, allowlist)).toEqual([]);
    });

    it('rejects local guards that only honor the OS setting', () => {
        const stylesheets = [{
            file: 'OsOnly.module.css',
            source: '.a { animation: pulse 1s infinite; }\n'
                + '@media (prefers-reduced-motion: reduce) { .a { animation: none; } }',
        }];
        expect(findUncoveredMotionCss(stylesheets, '')).toEqual([
            { file: 'OsOnly.module.css', kinds: ['animation'] },
        ]);
    });

    it('finds no uncovered motion in core source', () => {
        expect(runReducedMotionAudit().uncovered).toEqual([]);
    });
});
