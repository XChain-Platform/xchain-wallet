// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MINT carries no protocol fee, so neither its form nor its flow can request
// a native protocol-fee output on any chain.

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
assert.doesNotMatch(form, /nativeFeeForFeelessAction/, 'MintForm does not derive a native fee flag');
assert.doesNotMatch(form, /payFeeInNativeCoin/, 'MintForm never requests a native fee output');

// ---- mintToken flow rejects the encoder opt by omission ----
const flow = read('packages', 'core', 'src', 'flows', 'mintToken.js');
assert.doesNotMatch(flow, /payFeeInNativeCoin/, 'mintToken cannot forward a native fee flag');

console.log('mint-native-fee smoke: all assertions passed');
