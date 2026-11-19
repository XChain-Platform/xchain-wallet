// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// All actions picks each entry's icon by its action id, so a label that
// starts with "My" never falls back to the eye icon: My orders and Create
// order show the market icon and My swaps the swap icon.

import { describe, expect, it } from 'vitest';
import { ENTRY_ICON } from '../../../packages/core/src/shared/routes/ActionsMenu.jsx';
import { ACTION_ENTRY_DEFS } from '../../../packages/core/src/shared/actionEntries.js';
import * as Icon from '../../../packages/core/src/ui/icons/index.jsx';

describe('All actions entry icons', () => {
    it.each([
        ['create-order', Icon.MarketIcon],
        ['my-orders', Icon.MarketIcon],
        ['my-swaps', Icon.SwapIcon],
    ])('%s has its own icon by action id', (id, expected) => {
        expect(ACTION_ENTRY_DEFS.some((entry) => entry.id === id), `${id} is an All actions entry`).toBe(true);
        expect(ENTRY_ICON[id]).toBe(expected);
        expect(ENTRY_ICON[id]).not.toBe(Icon.EyeIcon);
    });

    it('resolves the My orders row by id before the label rule', () => {
        // The label rule maps "My ..." to the eye; the id map must win over it.
        const myOrders = ACTION_ENTRY_DEFS.find((entry) => entry.id === 'my-orders');
        const myOrdersIcon = ENTRY_ICON[myOrders.id] || Icon.iconForLabel(myOrders.label);
        expect(myOrdersIcon).toBe(Icon.MarketIcon);
    });
});
