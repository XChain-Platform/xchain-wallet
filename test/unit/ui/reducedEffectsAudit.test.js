// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    findUngatedBackdropFilters,
    hasReducedEffectsGuard,
    runReducedEffectsAudit,
} from '../../../packages/core/scripts/reduced-effects-audit.js';

describe('reduced-effects CSS audit', () => {
    it('lists literal backdrop filters with their source lines', () => {
        const stylesheets = [{
            file: 'Example.module.css',
            source: '.safe { backdrop-filter: var(--xc-backdrop-filter); }\n'
                + '.costly { -webkit-backdrop-filter: blur(18px); }',
        }];
        expect(findUngatedBackdropFilters(stylesheets)).toEqual([{
            file: 'Example.module.css',
            line: 2,
            value: 'blur(18px)',
        }]);
    });

    it('requires OS and shell reduced-effects controls', () => {
        const guarded = `
            :root {
                --xc-backdrop-filter: blur(2px);
                --xc-list-shadow: var(--xc-shadow-md);
                --xc-privacy-filter: blur(12px);
                --xc-privacy-opacity: 1;
            }
            @media (prefers-reduced-motion: reduce) {
                :root { --xc-backdrop-filter: none; }
            }
            :root[data-xc-low-power="true"] {
                --xc-list-shadow: none;
                --xc-privacy-filter: none;
                --xc-privacy-opacity: 0;
            }
            :root[data-xc-low-power="true"],
            :root[data-xc-low-power="true"] * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
            [role="listbox"] { box-shadow: none !important; }
        `;
        expect(hasReducedEffectsGuard(guarded)).toBe(true);
        expect(hasReducedEffectsGuard(guarded.replace('--xc-privacy-opacity: 0;', ''))).toBe(false);
    });

    it('finds no ungated backdrop filters in core source', () => {
        const audit = runReducedEffectsAudit();
        expect(audit.hasGuard).toBe(true);
        expect(audit.ungatedBackdropFilters).toEqual([]);
    });
});
