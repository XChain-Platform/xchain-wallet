// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { compareDecimal } from '../../../packages/core/src/shared/utils/mintHeadroom.js';
import { readTestnetGasHeadroom } from './testnet_mint.js';

export const MINT_AMOUNT = 200;

export async function preflightGasHeadroom(amount, { explorerUrl, coin, fetch }) {
    const headroom = await readTestnetGasHeadroom({ explorerUrl, coin, fetch });
    if (headroom === null || compareDecimal(headroom, String(amount)) !== -1) {
        return headroom;
    }
    throw new Error(`Gas headroom preflight refused: headroom ${headroom} is below amount ${amount}`);
}
