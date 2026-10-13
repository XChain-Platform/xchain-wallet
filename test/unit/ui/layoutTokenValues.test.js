// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const tokensCss = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
const shellCss = readFileSync('packages/core/src/shared/components/LeftNav.module.css', 'utf8');

function blocks(source, marker) {
    const matches = [];
    let cursor = 0;

    while ((cursor = source.indexOf(marker, cursor)) !== -1) {
        const open = source.indexOf('{', cursor);
        let close = open + 1;
        let depth = 1;

        while (depth > 0) {
            if (source[close] === '{') depth += 1;
            if (source[close] === '}') depth -= 1;
            close += 1;
        }

        matches.push(source.slice(open + 1, close - 1));
        cursor = close;
    }

    return matches;
}

function declarations(source, selector) {
    const body = blocks(source, `${selector} {`)[0];
    return Object.fromEntries(
        [...body.matchAll(/(--xc-[\w-]+):\s*([^;]+);/g)]
            .map((match) => [match[1], match[2].trim()]),
    );
}

function resolvedValue(values, token) {
    const value = values[token];
    const reference = /^var\((--xc-[\w-]+)\)$/.exec(value);
    return reference ? resolvedValue(values, reference[1]) : value;
}

describe('layout token values', () => {
    const root = declarations(tokensCss, ':root');

    it('pins page gutters for compact, rail, and full layouts', () => {
        const rail = { ...root, ...declarations(shellCss, ".layout[data-xc-tier='rail']") };
        const full = { ...root, ...declarations(shellCss, ".layout[data-xc-tier='full']") };

        expect(resolvedValue(root, '--xc-page-gutter')).toBe('12px');
        expect(resolvedValue(rail, '--xc-page-gutter')).toBe('16px');
        expect(resolvedValue(full, '--xc-page-gutter')).toBe('24px');
    });

    it('pins mouse and coarse-pointer control geometry', () => {
        expect([
            resolvedValue(root, '--xc-control-h-sm'),
            resolvedValue(root, '--xc-control-h-md'),
            resolvedValue(root, '--xc-control-h-lg'),
        ]).toEqual(['28px', '36px', '44px']);
        expect(resolvedValue(root, '--xc-control-radius')).toBe('8px');

        const coarseBody = blocks(tokensCss, '@media (pointer: coarse), (hover: none)')
            .find((body) => body.includes('--xc-control-h-sm'));
        const coarse = { ...root, ...declarations(coarseBody, ':root') };

        expect([
            resolvedValue(coarse, '--xc-control-h-sm'),
            resolvedValue(coarse, '--xc-control-h-md'),
            resolvedValue(coarse, '--xc-control-h-lg'),
        ]).toEqual(['36px', '44px', '48px']);
    });

    it('pins the section gap', () => {
        expect(resolvedValue(root, '--xc-section-gap')).toBe('16px');
    });
});
