// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the shared field-size contract: text controls use the shared
// sm/md/lg tokens, default to md, and preserve the composed-field wiring.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const inputJs = read('packages', 'core', 'src', 'ui', 'Input.jsx');
const inputCss = read('packages', 'core', 'src', 'ui', 'Input.module.css');
const tokensCss = read('packages', 'core', 'src', 'ui', 'tokens.css');
const selectJs = read('packages', 'core', 'src', 'ui', 'Select.jsx');
const textareaJs = read('packages', 'core', 'src', 'ui', 'Textarea.jsx');
const iconSelectJs = read('packages', 'core', 'src', 'ui', 'IconSelect.jsx');
const iconSelectCss = read('packages', 'core', 'src', 'ui', 'IconSelect.module.css');
const amountJs = read('packages', 'core', 'src', 'shared', 'components', 'AmountField.jsx');
const amountCss = read('packages', 'core', 'src', 'shared', 'components', 'AmountField.module.css');
const sendJs = read('packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');

// --- Shared control tokens ---------------------------------------------

assert.match(tokensCss, /--xc-control-h-sm:\s*32px/, 'sm control height is 32px');
assert.match(tokensCss, /--xc-control-h-md:\s*40px/, 'md control height is 40px');
assert.match(tokensCss, /--xc-control-h-lg:\s*48px/, 'lg control height is 48px');
assert.match(tokensCss, /--xc-control-radius:\s*var\(--xc-radius-md\)/,
    'control radius reuses the input radius');
assert.match(tokensCss, /--xc-control-font:\s*var\(--xc-text-md\)/,
    'control font reuses the body font size');
assert.match(tokensCss, /--xc-control-pad-x:\s*var\(--xc-space-3\)/,
    'control horizontal padding uses space-3');

// --- Input: size prop + shared visual contract -------------------------

assert.match(inputJs, /size = 'md'/, 'Input defaults size to md');
assert.match(inputJs, /\$\{styles\[size\]/, 'Input applies the size class to the field wrapper');
for (const size of ['sm', 'md', 'lg']) {
    assert.match(inputCss, new RegExp(`\\.${size}\\s*\\{[^}]*--xc-control-height:\\s*var\\(--xc-control-h-${size}\\)`, 's'),
        `Input ${size} uses its shared height token`);
}
for (const [size, inset] of Object.entries({ sm: '-6px 0', md: '-2px 0', lg: '0' })) {
    const insetRule = new RegExp(`\\.${size}\\s*\\{[^}]*--xc-control-hit-inset:\\s*${inset}`);
    assert.match(inputCss, insetRule, `Input ${size} reaches a 44px coarse-pointer area`);
    assert.match(iconSelectCss, insetRule, `IconSelect ${size} reaches a 44px coarse-pointer area`);
}
assert.match(inputCss, /\.input:not\(textarea\)\s*\{[^}]*height:\s*var\(--xc-control-height\)/s,
    'Input and Select render the selected height token');
assert.match(inputCss, /\.input\s*\{[^}]*font-size:\s*var\(--xc-control-font\)/s,
    'Input, Select, and Textarea use the control font token');
assert.match(inputCss, /\.input\s*\{[^}]*border-radius:\s*var\(--xc-control-radius\)/s,
    'Input, Select, and Textarea use the control radius token');
assert.match(inputCss, /\.input:not\(textarea\)\s*\{[^}]*padding:\s*0 var\(--xc-control-pad-x\)/s,
    'Input and Select use the control horizontal padding token');
assert.match(inputCss, /\.lg \.label\s*\{/, '.lg bumps the label');
assert.match(inputCss, /@media \(pointer: coarse\), \(hover: none\)[\s\S]*\.controlHitArea::before\s*\{[^}]*inset:\s*var\(--xc-control-hit-inset\)/s,
    'native controls expand their coarse-pointer hit area without changing the box');

// --- Select + Textarea share the same size prop ------------------------

assert.match(selectJs, /size = 'md'/, 'Select takes size');
assert.match(selectJs, /\$\{styles\[size\]/, 'Select applies the size class');
assert.match(textareaJs, /size = 'md'/, 'Textarea takes size');
assert.match(textareaJs, /\$\{styles\[size\]/, 'Textarea applies the size class');

// --- IconSelect uses the same contract ---------------------------------

assert.match(iconSelectJs, /size = 'md'/, 'IconSelect defaults size to md');
assert.match(iconSelectJs, /\$\{styles\[size\]/, 'IconSelect applies the size class');
for (const size of ['sm', 'md', 'lg']) {
    assert.match(iconSelectCss, new RegExp(`\\.${size}\\s*\\{[^}]*--xc-control-height:\\s*var\\(--xc-control-h-${size}\\)`, 's'),
        `IconSelect ${size} uses its shared height token`);
}
assert.match(iconSelectCss, /\.trigger\s*\{[^}]*height:\s*var\(--xc-control-height\)/s,
    'IconSelect renders the selected height token');
assert.match(iconSelectCss, /\.trigger\s*\{[^}]*font-size:\s*var\(--xc-control-font\)/s,
    'IconSelect uses the control font token');
assert.match(iconSelectCss, /\.trigger\s*\{[^}]*border-radius:\s*var\(--xc-control-radius\)/s,
    'IconSelect uses the control radius token');
assert.match(iconSelectCss, /\.trigger\s*\{[^}]*padding:\s*0 var\(--xc-control-pad-x\)/s,
    'IconSelect uses the control horizontal padding token');
assert.match(iconSelectCss, /@media \(pointer: coarse\), \(hover: none\)[\s\S]*\.trigger::before\s*\{[^}]*inset:\s*var\(--xc-control-hit-inset\)/s,
    'IconSelect expands its coarse-pointer hit area without changing the box');

// --- AmountField forwards size and composes shared controls ------------

assert.match(amountJs, /size = 'md'/, 'AmountField defaults size to md');
assert.match(amountJs, /<Input\s+ref=\{inputRef\}\s+size=\{size\}/s, 'AmountField forwards size to Input');
assert.doesNotMatch(amountCss, /\.bigField/, 'AmountField leaves big-field rules to Input');
assert.doesNotMatch(amountJs, /fontSize: 'var\(--xc-text-lg\)'/, 'AmountField leaves big-field styles to Input');
assert.match(amountJs, /<Button\s+variant="primary"\s+size="sm"/s, 'Max uses the shared small primary Button');
assert.match(amountJs, /bottom: size === 'lg' \? '10px' : '4px'/, 'Max button offset is keyed to field size');

// --- Send opts its hero fields into lg ---------------------------------

assert.match(sendJs, /<AddressCombobox\s+size="lg"/s, 'Send To field is lg');
assert.match(sendJs, /<AmountField\s+size="lg"/s, 'Send Amount field is lg');

console.log('field-size-prop smoke OK');
