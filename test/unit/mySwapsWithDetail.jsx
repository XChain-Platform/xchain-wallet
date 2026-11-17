// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// My Swaps with its rows opening Swap Details, the way each shell wires the
// my-swaps and swap-detail routes, for tests that drive a swap from its list
// row to Edit or Cancel. Back from the details returns to the list.

import React, { useState } from 'react';
import { MySwapsView } from '../../packages/core/src/shared/routes/MySwapsView.jsx';
import { SwapDetail } from '../../packages/core/src/shared/routes/SwapDetail.jsx';

export function MySwapsWithDetail(props) {
    const [ref, setRef] = useState(null);
    if (ref) {
        return <SwapDetail {...props} chainId={ref.chainId} actionIndex={ref.actionIndex} onBack={() => setRef(null)} />;
    }
    return <MySwapsView {...props} onOpenSwap={(chainId, actionIndex) => setRef({ chainId, actionIndex })} />;
}

/**
 * A listed swap's list item, found by its action index (the ring layout's
 * row names the trade, not the swap's number).
 */
export function swapRowItem(utils, actionIndex) {
    const list = utils.getByRole('list', { name: 'Swaps' });
    const row = list.querySelector(`[data-swap-row$=":${actionIndex}"]`);
    if (!row) throw new Error(`no row for swap #${actionIndex}`);
    return row;
}

/** Opens a listed swap's details by clicking its row. */
export function swapRowButton(within, utils, actionIndex) {
    return within(swapRowItem(utils, actionIndex)).getByRole('button');
}
