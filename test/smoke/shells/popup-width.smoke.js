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
const widthRules = [...popupCss.matchAll(/([^{}]+)\{([^{}]*\bwidth:\s*min\(360px,\s*100vw\);[^{}]*)\}/g)];

assert.equal(widthRules.length, 1, 'popup.css has one 360px document width cap');
assert.equal(
    widthRules[0][1].trim(),
    'html.xchain-toolbar-popup',
    'the 360px width cap only applies to the toolbar popup class',
);

console.log('popup-width smoke: PASS');
