// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Drives the Create Order form's Asset picker page the way a person does:
// open the side's asset field, type the ticker into the search and take it
// with "Use Typed Name", which works for a held token and for one the list
// does not hold. The form shows the Quick view by default.

import { fireEvent, screen } from '@testing-library/react';

// Quick names the fields Give asset and Get asset; Full shows two fields
// both labelled Asset, give first.
async function openAssetPicker(side, full) {
    if (full) {
        const fields = await screen.findAllByRole('button', { name: /^Asset:/ });
        fireEvent.click(fields[side === 'give' ? 0 : 1]);
        return;
    }
    const label = side === 'give' ? 'Give asset' : 'Get asset';
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label}:`) }));
}

/** The Full view of the order form, which the form remembers per browser. */
export function showFullOrderView() {
    localStorage.setItem('xc.giveGet.view.order', 'full');
}

/**
 * @param {'give' | 'get'} side
 * @param {string} tick  a ticker or ^ID typed into the picker search
 * @param {{ full?: boolean }} [options]  true when the form shows the Full view
 */
export async function pickOrderAsset(side, tick, { full = false } = {}) {
    await openAssetPicker(side, full);
    fireEvent.click(await screen.findByRole('button', { name: 'Filter coins and tokens' }));
    fireEvent.change((await screen.findAllByLabelText('Search coins or tokens'))[0], { target: { value: tick } });
    fireEvent.click(await screen.findByRole('button', { name: 'Use Typed Name' }));
}

/** Opens a closed standard section (Ownership, Order Terms, Network fee) by its title. */
export function openOrderSection(title) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${title}\\b`), expanded: false }));
}

/** Picks the network coin on a side from the Asset picker's coin row. */
export async function pickOrderCoin(side, coinName, { full = false } = {}) {
    await openAssetPicker(side, full);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Select ${coinName} on `) }));
}
