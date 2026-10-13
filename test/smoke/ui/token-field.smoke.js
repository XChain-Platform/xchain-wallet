// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for TokenField: the inline token-select field (icon + ticker + chain
// + caret) that opens the full-page TokenPicker via onOpenPicker and is sized
// to match the shared Input.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const cmp = read('packages', 'core', 'src', 'shared', 'components', 'TokenField.jsx');
const css = read('packages', 'core', 'src', 'shared', 'components', 'TokenField.module.css');
const sendJs = read('packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');

// --- component shape ---------------------------------------------------

assert.match(cmp, /export function TokenField/, 'named export');
assert.match(cmp, /import \{ TickerIcon \}/, 'renders the shared token icon');
assert.match(cmp, /<TickerIcon chainId=\{chainId\} tick=\{tick\}/, 'passes chain + tick to TickerIcon');

// presentation + click: opens the picker via a host callback, no routing baked in
assert.match(cmp, /onClick=\{onOpenPicker\}/, 'click opens the picker via the host callback');
assert.match(cmp, /type="button"/, 'control is a button');

// empty state + labels
assert.match(cmp, /placeholder = 'Select a token'/, 'default empty-state placeholder');
assert.match(cmp, /const hasValue = Boolean\(chainId && tick\)/, 'renders the empty state when no value');
assert.match(cmp, /aria-label=\{accessibleName\}/, 'button carries an accessible name with the selection');

// size contract matches Input
assert.match(cmp, /size = 'md'/, 'defaults to md');
assert.match(cmp, /\$\{styles\[size\]/, 'applies the size class to the field wrapper');

// --- CSS: chrome matches Input at both sizes ---------------------------

assert.match(css, /\.field\s*\{[^}]*--token-field-control-height:\s*var\(--xc-control-h-md\)/s,
    'TokenField defaults to the md control height token');
assert.match(css, /\.control\s*\{[^}]*height:\s*var\(--token-field-control-height\)/s,
    'control renders the selected height token');
assert.match(css, /\.control\s*\{[^}]*border:\s*1px solid var\(--xc-border-strong\)/s, 'control borrows Input border chrome');
assert.match(css, /\.lg\s*\{[^}]*--token-field-control-height:\s*var\(--xc-control-h-lg\)/s,
    'lg control uses the hero height token');
assert.match(css, /\.control\s*\{[^}]*padding:\s*0 var\(--xc-control-pad-x\)/s,
    'control uses shared horizontal padding');
assert.match(css, /\.control\s*\{[^}]*font-size:\s*var\(--xc-control-font\)/s,
    'control uses the shared font');
assert.match(css, /\.control\s*\{[^}]*border-radius:\s*var\(--xc-control-radius\)/s,
    'control uses the shared radius');
for (const cls of ['field', 'label', 'control', 'text', 'tick', 'chain', 'placeholder', 'caret']) {
    assert.match(css, new RegExp(`\\.${cls}\\b`), `CSS hook .${cls}`);
}

// --- Send adopts it (with a bare-input fallback when no picker) ---------

assert.match(sendJs, /import \{ TokenField \} from '\.\.\/components\/TokenField\.jsx'/, 'Send imports TokenField');
assert.match(sendJs, /<TokenField[\s\S]{0,240}onOpenPicker=\{\(\) => onChangeAsset\(/, 'Send wires TokenField to the asset picker');

console.log('token-field smoke OK');
