// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sharedComponents = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components');

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return ['.css', '.js', '.jsx'].includes(extname(entry.name)) ? [path] : [];
    });
}

const violations = [];
for (const file of sourceFiles(sharedComponents)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/<svg\b[^>]*>/gs)) {
        if (/\b(?:width|height)\s*=\s*(?:\\?["']\s*\d|\{\s*\d)/.test(match[0])) {
            const line = source.slice(0, match.index).split('\n').length;
            violations.push(`${relative(wsRoot, file)}:${line}`);
        }
    }
    for (const match of source.matchAll(/[^{}]*\bsvg\b[^{}]*\{[^}]*\}/g)) {
        if (/\b(?:width|height):\s*\d+(?:\.\d+)?px/.test(match[0])) {
            const line = source.slice(0, match.index).split('\n').length;
            violations.push(`${relative(wsRoot, file)}:${line}`);
        }
    }
}

assert.deepEqual(
    violations,
    [],
    `shared component SVGs use the Icon size scale instead of literal dimensions:\n${violations.join('\n')}`,
);

const tokens = readFileSync(join(wsRoot, 'packages', 'core', 'src', 'ui', 'tokens.css'), 'utf8');
for (const size of ['xs', 'sm', 'md', 'lg', 'xl']) {
    assert.match(tokens, new RegExp(`--xc-icon-${size}:\\s*\\d+px`), `tokens.css defines icon size ${size}`);
}

const icons = readFileSync(join(wsRoot, 'packages', 'core', 'src', 'ui', 'icons', 'index.jsx'), 'utf8');
// Icons mark themselves with data-xc-icon and tokens.css sizes them from the
// scale. var() must stay out of the SVG width and height attributes: Android
// WebView 102 ignores it there and draws the icon at 300px.
assert.match(icons, /'data-xc-icon'/, 'shared icons carry the data-xc-icon marker');
assert.doesNotMatch(icons, /(?:width|height|size):\s*'var\(/, 'icon size attributes never hold var()');
const tokensCss = readFileSync(join(wsRoot, 'packages', 'core', 'src', 'ui', 'tokens.css'), 'utf8');
assert.match(tokensCss, /svg\[data-xc-icon\]\)\s*\{[^}]*var\(--xc-icon-size, var\(--xc-icon-md\)\)/s, 'shared icons consume the size scale');
assert.match(icons, /'aria-hidden': 'true'/, 'shared decorative icons stay hidden from assistive technology');
assert.match(icons, /focusable: 'false'/, 'shared decorative icons cannot take SVG focus');

console.log('shared-icon-sizing smoke OK');
