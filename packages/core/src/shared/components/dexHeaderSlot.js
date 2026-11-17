// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext } from 'react';

/**
 * The DEX page header's spot for the right panel's tools. With two panels
 * showing, the market's filter and open-on-explorer buttons sit on the
 * "Decentralized Exchange" line rather than in a row of their own, so the
 * tops of the two panels line up (operator 2026-11-13). The page shows one
 * filter button: the market's order status goes inside the list's filter
 * menu. The value is `{ tools, filter }`, the elements the embedded market
 * view portals into (either null until mounted), or null outside the DEX.
 */
export const DexHeaderSlot = createContext(/** @type {{ tools: HTMLElement | null, filter: HTMLElement | null } | null} */ (null));
