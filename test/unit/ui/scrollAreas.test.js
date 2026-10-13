// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCREEN = 'packages/core/src/ui/Screen.module.css';
const AUDITED_SCROLL_STYLES = [
    SCREEN,
    'packages/core/src/shared/components/ConfirmActionModal.module.css',
    'packages/core/src/shared/components/GatedFileViewer.module.css',
    'packages/core/src/shared/components/LeftNav.module.css',
    'packages/core/src/shared/components/MarketTrading.module.css',
    'packages/core/src/shared/components/OverlaySurface.module.css',
    'packages/core/src/shared/routes/ContractScreens.module.css',
    'packages/core/src/shared/routes/Send.module.css',
];

function source(relativePath) {
    return readFileSync(`${ROOT}/${relativePath}`, 'utf8');
}

function overflowAutoBlocks(css) {
    return [...css.matchAll(/([^{}]+)\{([^{}]*overflow(?:-[xy])?\s*:\s*(?:auto|scroll)[^{}]*)\}/g)]
        .map(([, selector, declarations]) => ({ selector: selector.trim(), declarations }));
}

function composedScrollClasses(css) {
    return new Set(
        [...css.matchAll(/\.([A-Za-z][\w-]*)\s*\{[^{}]*composes:\s*scrollArea(?:\s|;)[^{}]*\}/g)]
            .map((match) => match[1]),
    );
}

function subjectClass(selector) {
    return [...selector.matchAll(/\.([A-Za-z][\w-]*)/g)].at(-1)?.[1];
}

function missingScrollClasses(css) {
    const composed = composedScrollClasses(css);
    return overflowAutoBlocks(css)
        .filter(({ selector }) => !composed.has(subjectClass(selector)))
        .map(({ selector }) => selector);
}

describe('shared scroll areas', () => {
    it('owns gutter reservation and the pointer scrollbar in one class', () => {
        const css = source(SCREEN);

        expect(css).toMatch(/\.scrollArea\s*\{[^}]*scrollbar-gutter:\s*stable/s);
        expect(css).toMatch(/\.scrollArea::-webkit-scrollbar\s*\{[^}]*width:\s*10px[^}]*height:\s*10px/s);
        expect(css).toMatch(/\.scrollArea::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--xc-border-strong\)/s);
        expect(css).toMatch(/\.screen\s*\{[^}]*overflow:\s*hidden/s);
    });

    it('flags audited overflow containers that omit the shared scroll class', () => {
        expect(missingScrollClasses('.fixture { overflow-y: auto; }')).toEqual(['.fixture']);
        expect(missingScrollClasses(`
            .scrollArea { scrollbar-gutter: stable; }
            .fixture {
                composes: scrollArea;
                overflow-y: auto;
            }
        `)).toEqual([]);

        const missing = AUDITED_SCROLL_STYLES.flatMap((file) => {
            const css = source(file);
            return missingScrollClasses(css).map((selector) => `${file}: ${selector}`);
        });

        expect(missing).toEqual([]);
    });
});
