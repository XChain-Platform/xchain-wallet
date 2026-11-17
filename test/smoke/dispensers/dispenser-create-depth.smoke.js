// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-20 dispenser create depth: DispenserForm gains the rest of
// the DISPENSER v0 field set - a token-priced lane (GET_TICK/GET_AMOUNT),
// a Unix EXPIRATION, and allow/block lists. (Third-party GET_ADDRESS
// already existed via the address-mode picker.)

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const src = read('packages', 'core', 'src', 'shared', 'routes', 'DispenserForm.jsx');

// Token-priced lane: GET_TICK + GET_AMOUNT emitted when paying with a token.
assert.match(src, /payWith === 'token'/, 'DispenserForm has a token-priced lane');
assert.match(src, /p\.GET_TICK = getTick\.trim\(\);/, 'token lane emits GET_TICK with its case kept');
assert.match(src, /p\.GET_AMOUNT = getTokenAmount\.trim\(\)/, 'token lane emits GET_AMOUNT');
assert.match(src, /Buyers pay with/, 'form offers a coin-vs-token payment choice');

// EXPIRATION as a Unix timestamp (not blocks), 'default' (3 months) omits it.
// The shared Expiration choice converts the Expires picker to Unix seconds.
const expirationChoice = read('packages', 'core', 'src', 'shared', 'components', 'expirationChoice.jsx');
assert.match(src, /const expiration = expirationParam\(expMode, expInput\);\s*if \(expiration\) p\.EXPIRATION = expiration;/,
    'emits EXPIRATION as a Unix timestamp from the shared Expiration choice');
assert.match(src, /localInputToUnix/, 'converts the datetime picker to Unix seconds');
assert.match(src, /<ExpirationFields/, 'expiration uses the shared Expiration choice');
assert.match(expirationChoice, /type="datetime-local"/, 'expiration uses a datetime picker');

// Allow/block lists via the shared PC-04 picker.
assert.match(src, /p\.ALLOW_LIST = allowListIdx/, 'emits ALLOW_LIST');
assert.match(src, /p\.BLOCK_LIST = blockListIdx/, 'emits BLOCK_LIST');
assert.match(src, /ListPickerScreen/, 'uses the shared list picker');

// Oracle/fiat pricing is coin-only: it hides in the token lane.
// The currency is the Fiat currency field and its picker page (G122).
assert.match(src, /payWith === 'coin' \? \(\s*<>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<FiatCurrencyField\s+id="dispenser-fiat-code"/, 'oracle/fiat advanced section is coin-only');

console.log('dispenser-create-depth smoke: all assertions passed');
