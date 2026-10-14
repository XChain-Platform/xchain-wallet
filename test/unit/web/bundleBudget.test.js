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
    WEB_INITIAL_CSS_SIZE_LIMIT,
    WEB_INITIAL_JS_SIZE_LIMIT,
    initialBundleSizes,
} from '../../../packages/web/bundleBudget.js';

function chunk(fileName, code, options = {}) {
    return {
        type: 'chunk',
        fileName,
        name: options.name ?? fileName,
        isEntry: options.isEntry ?? false,
        code,
        imports: options.imports ?? [],
        dynamicImports: options.dynamicImports ?? [],
        viteMetadata: { importedCss: new Set(options.css ?? []) },
    };
}

describe('web initial bundle budget', () => {
    it('keeps a small margin above the measured production entry', () => {
        expect(WEB_INITIAL_JS_SIZE_LIMIT).toBe(900_000);
        expect(WEB_INITIAL_CSS_SIZE_LIMIT).toBe(100_000);
    });

    it('counts static JS and CSS while excluding lazy route assets', () => {
        const bundle = {
            'assets/index.js': chunk('assets/index.js', 'entry', {
                name: 'index',
                isEntry: true,
                imports: ['assets/shared.js'],
                dynamicImports: ['assets/markets.js'],
                css: ['assets/index.css'],
            }),
            'assets/shared.js': chunk('assets/shared.js', 'shared', {
                css: ['assets/shared.css'],
            }),
            'assets/markets.js': chunk('assets/markets.js', 'lazy route', {
                css: ['assets/markets.css'],
            }),
            'assets/index.css': { type: 'asset', source: 'base', fileName: 'assets/index.css' },
            'assets/shared.css': { type: 'asset', source: 'shell', fileName: 'assets/shared.css' },
            'assets/markets.css': { type: 'asset', source: 'lazy', fileName: 'assets/markets.css' },
        };

        expect(initialBundleSizes(bundle)).toEqual({
            jsBytes: Buffer.byteLength('entryshared'),
            cssBytes: Buffer.byteLength('baseshell'),
        });
    });
});
