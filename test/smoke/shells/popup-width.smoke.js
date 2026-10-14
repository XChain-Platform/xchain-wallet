// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const popupCss = readFileSync(
    join(here, '..', '..', '..', 'packages', 'extension', 'src', 'popup', 'popup.css'),
    'utf8',
);
// The toolbar popup sizes itself from its content, so it needs fixed
// lengths; a width relative to its own viewport collapses it to 25px.
const widthRules = [...popupCss.matchAll(/([^{}]+)\{([^{}]*\bwidth:\s*360px;[^{}]*\bheight:\s*600px;[^{}]*)\}/g)];

assert.equal(widthRules.length, 1, 'popup.css pins one 360 by 600 toolbar popup size');
assert.ok(
    widthRules[0][1].trim().endsWith('html.xchain-toolbar-popup'),
    'the fixed popup size only applies to the toolbar popup class',
);
assert.doesNotMatch(popupCss, /html\.xchain-toolbar-popup\s*\{[^}]*100v[wh]/, 'the toolbar popup size is never relative to its own viewport');

console.log('popup-width smoke: PASS');
