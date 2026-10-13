// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRules } from '../../../packages/core/scripts/forced-colors-audit.js';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../../../packages/core/src/ui/tokens.css'), 'utf8');
const selector = [
    "input:not([type='checkbox']):not([type='radio']):not([type='range'])",
    'select',
    'textarea',
].join(',\n    ');
const rules = parseRules(css).filter((rule) => rule.selector === selector);

assert.equal(rules.length, 1, 'tokens.css defines one shared text-control font floor');
assert.match(rules[0].body, /font-size:\s*1rem\s*!important\s*;/,
    'the shared text-control font floor is 1rem and overrides local declarations');
assert.deepEqual(rules[0].at, ['@media (max-width: 599px)'],
    'the font floor applies below 600px without changing desktop control sizes');

console.log('mobile-form-control-font-size smoke OK');
