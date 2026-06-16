// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Bundled chain registry snapshot. A future runtime-refresh path (§9.7)
// will merge updates from sdk.hub config; until then, this is the
// authoritative list shipped with each wallet release.

import { bitcoinDescriptors } from './bitcoin.js';
import { dogecoinDescriptors } from './dogecoin.js';
import { litecoinDescriptors } from './litecoin.js';

/** @type {import('../validate.js').ChainDescriptor[]} */
export const BUNDLED_DESCRIPTORS = [
    ...bitcoinDescriptors,
    ...dogecoinDescriptors,
    ...litecoinDescriptors,
];

export { bitcoinDescriptors, dogecoinDescriptors, litecoinDescriptors };
