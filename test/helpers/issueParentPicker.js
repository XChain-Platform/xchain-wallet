// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Drives the Issue Token form's Parent token field the way a person does:
// tap the field, which opens the standard token picker listing the tokens
// this wallet owns, and tap the parent's row. The messaging mock answers
// getOwnedTokens with `ownedTokensFor` so the row is on the list.

import { fireEvent, screen } from '@testing-library/react';

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A getOwnedTokens mock that answers `ticks` for `owner` and nothing for any
 * other address.
 *
 * @param {(fn?: Function) => any} fnFactory  vi.fn
 * @param {string} owner
 * @param {string[]} ticks
 */
export function ownedTokensFor(fnFactory, owner, ticks) {
    return fnFactory(({ address }) => Promise.resolve(
        address === owner ? ticks.map((tick) => ({ tick })) : [],
    ));
}

/** The Parent token field: a button named "Parent token: <selection>". */
export function parentTokenField() {
    return screen.getByRole('button', { name: /^Parent token:/ });
}

/**
 * Opens the Parent token picker and takes `tick`'s row.
 *
 * @param {string} tick
 */
export async function pickParentToken(tick) {
    fireEvent.click(await screen.findByRole('button', { name: /^Parent token:/ }));
    fireEvent.click(await screen.findByRole('button', {
        name: new RegExp(`^Select ${escapeRegExp(tick)}( on |$)`),
    }));
    await screen.findByRole('button', { name: new RegExp(`^Parent token: ${escapeRegExp(tick)}( on |$)`) });
}
