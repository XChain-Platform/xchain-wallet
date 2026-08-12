// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-51: MINT joins the native-coin fee-payment surfaces. Asserts
// MintForm mounts the shared NativeFeeToggle and plumbs payFeeInNativeCoin
// into BOTH submit paths (the compose preview + the legacy submit),
// and that the mintToken flow forwards it into encoderOpts.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- MintForm surface ----
const form = read('packages', 'core', 'src', 'shared', 'routes', 'MintForm.jsx');
assert.match(form, /import \{ NativeFeeToggle \}/, 'MintForm imports NativeFeeToggle');
assert.match(form, /<NativeFeeToggle/, 'MintForm renders the toggle');
assert.match(form, /setPayFeeInNativeCoin/, 'MintForm holds the toggle state');
// The opt-in must reach the compose step so the fee output sits in the
// previewed PSBT, AND the submit payload.
const composeHasFlag = /encoderOpts:\s*\{\s*payFeeInNativeCoin/.test(form);
assert.ok(composeHasFlag, 'MintForm passes payFeeInNativeCoin into compose/encoderOpts');
const occurrences = (form.match(/payFeeInNativeCoin: payFeeInNativeCoin \|\| undefined/g) || []).length;
assert.ok(occurrences >= 3, `MintForm plumbs the flag across compose + both submit paths (found ${occurrences})`);

// ---- mintToken flow threads the encoder opt ----
const flow = read('packages', 'core', 'src', 'flows', 'mintToken.js');
assert.match(flow, /opts\.payFeeInNativeCoin !== undefined && \{ payFeeInNativeCoin: opts\.payFeeInNativeCoin \}/, 'mintToken forwards payFeeInNativeCoin into encoderOpts');

console.log('mint-native-fee smoke: all assertions passed');
