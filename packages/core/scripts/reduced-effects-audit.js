// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const coreSourceRoot = join(here, '..', 'src');
const tokensPath = join(coreSourceRoot, 'ui', 'tokens.css');

function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/**
 * List backdrop-filter declarations that bypass the reduced-effects token.
 *
 * @param {{file: string, source: string}[]} stylesheets
 * @returns {{file: string, line: number, value: string}[]}
 */
export function findUngatedBackdropFilters(stylesheets) {
    const ungated = [];
    for (const { file, source } of stylesheets) {
        const css = stripComments(source);
        const declaration = /(?:^|[;{])\s*(?:-webkit-)?backdrop-filter\s*:\s*([^;}]+)/gim;
        let match;
        while ((match = declaration.exec(css)) !== null) {
            const value = match[1].trim();
            if (value.includes('var(--xc-backdrop-filter)')) continue;
            const propertyOffset = match.index
                + match[0].search(/(?:-webkit-)?backdrop-filter/i);
            ungated.push({
                file,
                line: css.slice(0, propertyOffset).split('\n').length,
                value,
            });
        }
    }
    return ungated;
}

/**
 * Check that the shared stylesheet exposes both OS and shell reduced-effects
 * paths, including the privacy fallback that hides content without a blur.
 *
 * @param {string} source
 * @returns {boolean}
 */
export function hasReducedEffectsGuard(source) {
    const compact = stripComments(source).replace(/\s+/g, ' ');
    const required = [
        '--xc-backdrop-filter: blur(2px)',
        '--xc-list-shadow: var(--xc-shadow-md)',
        '--xc-privacy-filter: blur(12px)',
        '--xc-privacy-opacity: 1',
        '@media (prefers-reduced-motion: reduce)',
        ':root[data-xc-low-power="true"]',
        '--xc-backdrop-filter: none',
        '--xc-list-shadow: none',
        '--xc-privacy-filter: none',
        '--xc-privacy-opacity: 0',
        '[role="listbox"]',
        'box-shadow: none !important',
        ':root[data-xc-low-power="true"] *',
        'animation-duration: 0.01ms !important',
        'animation-iteration-count: 1 !important',
        'transition-duration: 0.01ms !important',
    ];
    return required.every((text) => compact.includes(text));
}

function listCss(dir, files = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) listCss(path, files);
        else if (entry.name.endsWith('.css')) files.push(path);
    }
    return files;
}

export function runReducedEffectsAudit() {
    const stylesheets = listCss(coreSourceRoot).map((path) => ({
        file: relative(repoRoot, path).split(sep).join('/'),
        source: readFileSync(path, 'utf8'),
    }));
    const tokens = readFileSync(tokensPath, 'utf8');
    return {
        stylesheetCount: stylesheets.length,
        hasGuard: hasReducedEffectsGuard(tokens),
        ungatedBackdropFilters: findUngatedBackdropFilters(stylesheets),
    };
}
