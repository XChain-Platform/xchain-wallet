// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for U81 (superseding PC-51 for MINT): MINT carries no protocol fee
// in xchain-indexer, so MintForm mounts no NativeFeeToggle and never passes
// payFeeInNativeCoin on any chain; on LTC and DOGE a native output would be a
// fee paid for nothing. The generic mintToken flow keeps its encoder opt.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- MintForm surface ----
const form = read('packages', 'core', 'src', 'shared', 'routes', 'MintForm.jsx');
assert.doesNotMatch(form, /NativeFeeToggle/, 'MintForm mounts no native protocol-fee toggle');
assert.doesNotMatch(form, /useNativeFee/, 'MintForm does not mount the useNativeFee hook');
assert.doesNotMatch(form, /payFeeInNativeCoin/, 'MintForm never passes payFeeInNativeCoin');

// ---- mintToken flow threads the encoder opt ----
const flow = read('packages', 'core', 'src', 'flows', 'mintToken.js');
assert.match(flow, /opts\.payFeeInNativeCoin !== undefined && \{ payFeeInNativeCoin: opts\.payFeeInNativeCoin \}/, 'mintToken forwards payFeeInNativeCoin into encoderOpts');

console.log('mint-native-fee smoke: all assertions passed');
