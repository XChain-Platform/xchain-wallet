// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for : History fiat-display toggle.
//
// Pins: the settings-backed toggle, the fiat computation being gated to
// native-coin amounts only (never a token's), and the Amount row wiring
// into DetailCard. Source-grep only, matching this suite's house style
// for pinning already-shipped wiring (see history-cross-chain-link.smoke.js).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const historyPath = join(root, 'packages', 'core', 'src', 'shared', 'routes', 'History.jsx');
const schemaPath = join(root, 'packages', 'core', 'src', 'schemas', 'settings.js');

const src = readFileSync(historyPath, 'utf8');
const schemaSrc = readFileSync(schemaPath, 'utf8');

// Settings schema carries the persisted flag.
assert.match(schemaSrc, /showFiatInHistory/, 'schema documents/defines showFiatInHistory');

// History reads + writes it through the standard useSettings() nested patch.
assert.match(src, /showFiatInHistory\s*=\s*Boolean\(proofSettings\.settings\?\.showFiatInHistory\)/, 'reads showFiatInHistory from settings');
assert.match(src, /proofSettings\.update\(\{\s*showFiatInHistory:\s*!showFiatInHistory\s*\}\)/, 'toggle writes through the nested-patch pattern');
assert.match(src, /Show fiat/, 'renders a Show-fiat control');

// The fiat rate uses the existing price-lookup plumbing (§45), not a
// bespoke fetch.
assert.match(src, /import \{ useFiatRate \}/, 'imports the shared useFiatRate hook');
assert.match(src, /import \{ coinToFiat \}/, 'imports coinToFiat from priceLookup');

// Native-only gate: nativeAmountFieldOf must reject anything with a
// non-native tick (a token movement), so a token amount can never be
// priced against the coin rate (the  latent bug this must not
// replicate).
assert.match(src, /function nativeAmountFieldOf/, 'defines the native-amount gate');
assert.match(src, /String\(tick\)\.toUpperCase\(\)\s*!==\s*nativeTicker\)\s*return null;.*token movement/s, 'rejects non-native ticks as token movements');
assert.match(src, /NATIVE_TICKER_BY_COIN/, 'maps coin family to its native ticker');

// Threaded through to the row + detail card that render it.
assert.match(src, /showFiatInHistory=\{showFiatInHistory\}/, 'threads showFiatInHistory into EntryRow/DetailCard');
assert.match(src, /const nativeAmount = showFiatInHistory \? nativeAmountFieldOf\(entry\) : null;/, 'DetailCard only computes a native amount when the toggle is on');

console.log('history-fiat-toggle smoke OK');
