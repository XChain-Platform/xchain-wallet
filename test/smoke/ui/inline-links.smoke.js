// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../../../packages/core/src/ui/tokens.css'), 'utf8');
const linkRule = /:where\(a\[href\]\)\s*\{([^}]*)\}/.exec(css);

assert.ok(linkRule, 'tokens.css defines a shared anchor rule');
assert.match(linkRule[1], /color:\s*var\(--xc-accent-text\)/,
    'links use the accent text token in light and dark themes');
assert.match(linkRule[1], /text-decoration:\s*underline/,
    'links remain distinguishable without color');
assert.match(linkRule[1], /text-underline-offset:\s*0\.15em/,
    'link underlines remain separated from their text');
assert.match(css, /:where\(a\[href\]:visited\)\s*\{[^}]*color:\s*var\(--xc-accent-text\)/s,
    'visited links retain the shared recognizable treatment');
assert.match(css,
    /:where\([\s\S]*?a\[href\][\s\S]*?\):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--xc-focus-ring\) !important/s,
    'links retain the shared keyboard focus ring');

console.log('OK: inline links use underline, theme-aware visited color, and visible focus');
