// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { LOCK_FLAGS } from '../utils/issueAdvancedFields.js';

const LOCK_COPY_BY_FIELD = new Map(LOCK_FLAGS.map((flag) => [flag.field, flag]));
const ISSUE_LOCK_KEYS = [
    ['maxSupply', 'LOCK_MAX_SUPPLY'],
    ['maxMint', 'LOCK_MAX_MINT'],
    ['minting', 'LOCK_MINT'],
    ['mintSupply', 'LOCK_MINT_SUPPLY'],
    ['description', 'LOCK_DESCRIPTION'],
    ['pause', 'LOCK_SLEEP'],
    ['callback', 'LOCK_CALLBACK'],
];

export const ISSUE_LOCKS = ISSUE_LOCK_KEYS.map(([key, field]) => ({
    key,
    field,
    label: LOCK_COPY_BY_FIELD.get(field).label,
    description: LOCK_COPY_BY_FIELD.get(field).hint,
}));
