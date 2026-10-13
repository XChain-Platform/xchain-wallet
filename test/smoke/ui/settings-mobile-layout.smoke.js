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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const css = readFileSync(
    join(repoRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.module.css'),
    'utf8',
);
const route = readFileSync(
    join(repoRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx'),
    'utf8',
);

assert.match(route, /import settingsStyles from '\.\/Settings\.module\.css';/,
    'Settings imports its responsive stylesheet');
assert.equal(
    route.match(/data-settings-layout="responsive"/g)?.length,
    2,
    'list and drilldown Settings pages share the responsive layout scope',
);
assert.match(css, /@media \(max-width: 360px\)/,
    'mobile Settings rules cover the 320px viewport');
assert.match(css, /input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='range'\]\)/,
    'fixed-width text and number inputs are selected without stretching toggles');
assert.match(css, /width: 100% !important;/,
    'fixed inline control widths become fluid at the narrow breakpoint');
assert.match(css, /flex: 1 1 100% !important;/,
    'labels and controls receive a full row before wrapping their own text');
assert.match(css, /flex-wrap: wrap !important;/,
    'custom fixed-width control rows wrap at the narrow breakpoint');
assert.match(css, /\.sectionHeader\s*\{[\s\S]*?position: static;/,
    'Settings section headers consistently remain in document flow');

console.log('settings mobile layout smoke OK');
