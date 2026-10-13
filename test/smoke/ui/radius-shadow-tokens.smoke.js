// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const tokensPath = join(repoRoot, 'packages', 'core', 'src', 'ui', 'tokens.css');
const componentsDir = join(repoRoot, 'packages', 'core', 'src', 'shared', 'components');
const tokensCss = readFileSync(tokensPath, 'utf8');
const violations = [];

for (const file of readdirSync(componentsDir).filter((name) => name.endsWith('.module.css'))) {
    const css = readFileSync(join(componentsDir, file), 'utf8');
    const lines = css.split('\n');

    for (const [index, line] of lines.entries()) {
        const radius = line.match(/^\s*border-radius:\s*([^;]+);/);
        if (radius && /\d+(?:\.\d+)?px/.test(radius[1]) && !radius[1].includes('var(')) {
            violations.push(`${file}:${index + 1} has a raw pixel radius`);
        }

        const shadow = line.match(/^\s*box-shadow:\s*([^;]+);/);
        if (shadow && !shadow[1].startsWith('var(') && shadow[1] !== 'none') {
            violations.push(`${file}:${index + 1} has a raw shadow`);
        }

        for (const match of line.matchAll(/var\((--xc-(?:radius|shadow)-[^,\s)]+)/g)) {
            if (!tokensCss.includes(`${match[1]}:`)) {
                violations.push(`${file}:${index + 1} references missing ${match[1]}`);
            }
        }
    }
}

assert.deepEqual(violations, []);
console.log('radius-shadow-tokens smoke OK');
