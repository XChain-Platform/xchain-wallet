// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const indexPath = join(root, 'packages', 'web', 'index.html');
const tokensPath = join(root, 'packages', 'core', 'src', 'ui', 'tokens.css');
const indexHtml = readFileSync(indexPath, 'utf8');
const tokens = readFileSync(tokensPath, 'utf8');

describe('web font loading', () => {
    it('preloads the same WOFF2 file used by the main text face', () => {
        const preloadHref = indexHtml.match(
            /<link\s+rel="preload"\s+href="([^"]+)"\s+as="font"\s+type="font\/woff2"\s+crossorigin\s*\/?>/,
        )?.[1];
        const fontSource = tokens.match(
            /font-family:\s*'XChain Sans';[\s\S]*?src:\s*url\('([^']+)'\) format\('woff2'\);/,
        )?.[1];

        expect(preloadHref).toBeTruthy();
        expect(fontSource).toBeTruthy();

        const preloadPath = resolve(dirname(indexPath), preloadHref);
        const cssFontPath = resolve(dirname(tokensPath), fontSource);
        expect(preloadPath).toBe(cssFontPath);

        const font = readFileSync(cssFontPath);
        expect(font.subarray(0, 4).toString('ascii')).toBe('wOF2');
    });

    it('shows a metric-matched system fallback while the font loads', () => {
        const mainFace = tokens.match(
            /@font-face\s*\{[\s\S]*?font-family:\s*'XChain Sans';[\s\S]*?\}/,
        )?.[0];
        const fallbackFace = tokens.match(
            /@font-face\s*\{[\s\S]*?font-family:\s*'XChain Sans Fallback';[\s\S]*?\}/,
        )?.[0];

        expect(mainFace).toMatch(/font-display:\s*swap;/);
        expect(mainFace).toMatch(/font-weight:\s*100 900;/);
        expect(fallbackFace).toMatch(/src:\s*local\('Arial'\);/);
        expect(fallbackFace).toMatch(/size-adjust:\s*107\.4%;/);
        expect(fallbackFace).toMatch(/ascent-override:\s*90\.2%;/);
        expect(fallbackFace).toMatch(/descent-override:\s*22\.48%;/);
        expect(fallbackFace).toMatch(/line-gap-override:\s*0%;/);
        expect(tokens).toMatch(
            /--xc-font-sans:\s*'XChain Sans', 'XChain Sans Fallback', system-ui,/,
        );
    });
});
