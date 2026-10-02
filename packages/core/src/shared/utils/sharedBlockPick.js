// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { listLabel } from './listLabel.js';

function validActionIndex(actionIndex) {
    if (typeof actionIndex === 'number') {
        return Number.isInteger(actionIndex) && actionIndex > 0;
    }

    return typeof actionIndex === 'string'
        && /^\d+$/.test(actionIndex)
        && /[1-9]/.test(actionIndex);
}

export function sharedBlockPickState(pick) {
    if (pick === null || typeof pick !== 'object' || !validActionIndex(pick.actionIndex)) {
        return null;
    }

    const blockListIdx = String(pick.actionIndex);

    return {
        blockListIdx,
        memberCount: typeof pick.memberCount === 'number' && Number.isFinite(pick.memberCount)
            ? pick.memberCount
            : null,
        label: `${listLabel(blockListIdx, pick.name)} (shared from ${pick.homeChain} list #${pick.homeListIndex})`,
    };
}
