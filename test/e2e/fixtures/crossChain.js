// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * Widget helpers for the ONE surface in the wallet that names two chains at
 * once.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT MORE OF `regtest.js`. Every helper in
 * that file is single-chain BY CONSTRUCTION: `REGTEST_COIN` resolves one venue
 * at import time, and `selectVenueChain` / `selectVenueSendAsset` both close
 * over that one chain's label and id. That is correct for the other 111 specs
 * and it is exactly what a cross-chain form cannot use, because the whole
 * subject here is the chain that is NOT the venue's. Rather than widen two
 * venue-pinned helpers with an optional second chain (which would let a
 * single-chain caller pass the wrong one silently), the named-chain forms live
 * here and take their chain explicitly, with no default.
 *
 * THE CAMPAIGN'S OWN MAP SAYS WHY THERE ARE TWO OF THEM. Its widget table
 * records that forms pick a chain three different ways and that a grep for one
 * reports the others as "has no picker". `CrossChainSwapForm` uses two of the
 * three AT ONCE: `ChainPicker`s labelled `Give chain` / `Get chain`
 * (:628, :678) and `TokenField`s labelled `Give token` / `Get token`
 * (:646, :697). The frontier row for this area recorded that ONE helper was
 * missing; measured at HEAD it is two, and the second is the widget class that
 * cost the campaign a 35-minute hang - `selectVenueSendAsset` anchors its
 * trigger on `/^Token: /`, and neither field here is named that.
 */

import { expect } from '@playwright/test';

/**
 * Picks a NAMED chain in a `ChainPicker`, on a named NETWORK, and proves the
 * pick took.
 *
 * The venue-pinned sibling (`selectVenueChain`) is the one to use for any
 * field that should follow the chain this run drives. Use this one only where
 * the chain is deliberately NOT the venue's - which in practice means the get
 * half of a cross-chain form.
 *
 * WHY THIS ONE ASSERTS THE NETWORK KIND AND THE VENUE HELPER DOES NOT, which
 * is a deliberate difference rather than an inconsistency. A chain's LABEL says
 * nothing about its network: `ChainPicker` names a mainnet entry `Dogecoin` and
 * a regtest one `Dogecoin · regtest` (`:115-119`), so matching on the label
 * alone would accept either. The venue helper can live with that because it
 * selects the chain the run is already pinned to; this one is handed a chain
 * name by a caller, and picking mainnet-Dogecoin instead of regtest-Dogecoin
 * would compose a swap offering to pay a counterparty on the REAL network. That
 * is the one wrong-chain outcome in this file worth being strict about, so the
 * option is matched on both halves and the trigger is asserted whole.
 *
 * @param {import('@playwright/test').Locator | import('@playwright/test').Page} scope
 * @param {string} field       the picker's label, e.g. 'Get chain'
 * @param {string} chainLabel  the chain's display name, e.g. 'Dogecoin'
 * @param {string} [networkKind]  the network suffix the picker renders, e.g. 'regtest'
 */
export async function selectNamedChain(scope, field, chainLabel, networkKind = 'regtest') {
    const trigger = scope.getByRole('button', { name: new RegExp(`^${field}:`) }).first();
    await expect(trigger, `no "${field}" chain picker on this screen`)
        .toBeVisible({ timeout: 30_000 });

    const want = `${field}: ${chainLabel} · ${networkKind}`;
    if (((await trigger.getAttribute('aria-label')) || '') === want) return;

    await trigger.click();
    // An option's accessible name is its label, its ticker and its network
    // suffix run together ("Dogecoin DOGE · regtest"), so both halves are
    // matched: the label alone would also select the mainnet entry sitting
    // beside it whenever the wallet holds an address on one.
    await scope.getByRole('option', {
        name: new RegExp(`^${chainLabel}\\b.*\\b${networkKind}\\b`),
    }).first().click();

    // Assert the switch took, WHOLE. The picker closes on click whether or not
    // the option was the one intended, so an unasserted click is a silent
    // wrong-chain run - the same hazard `selectVenueChain` ends on, and the
    // reason both helpers end this way.
    await expect(trigger, `the "${field}" picker did not settle on ${chainLabel} · ${networkKind}`)
        .toHaveAttribute('aria-label', want, { timeout: 15_000 });
}

/**
 * Picks a token in a `TokenField`, on a NAMED chain, and proves the pick took.
 *
 * TWO SCREEN FACTS THIS ENCODES, both of them things a locator cannot guess:
 *
 * 1. A `TokenField` is not a listbox. Its trigger NAVIGATES to a full
 *    `TokenPicker` screen that replaces the form, and that screen carries no
 *    `role="option"` anywhere - which is why driving one with a chain-picker
 *    helper waits out the entire test budget instead of failing. The picker is
 *    therefore addressed by its search box and its rows, never by options.
 *
 * 2. Rows are selected by `data-balance-key` (`${chainId}:${tick}`, written by
 *    `BalanceList`), NOT by their visible label. Every chain lists an XCHAIN,
 *    so the label is ambiguous exactly where a cross-chain spec needs it not to
 *    be: give-XCHAIN and get-XCHAIN differ only in the chain half of that key.
 *
 * WORKS FOR A TOKEN THE WALLET HAS NEVER HELD, which is what the get half
 * needs. `TokenPicker purpose="receive"` runs platform discovery: typing a tick
 * surfaces an "On the platform" section listing that tick on every chain the
 * wallet has an address on, rendered by the same `BalanceList` and so carrying
 * the same `data-balance-key`. The give half (`purpose="send"`) lists only held
 * balances, so its token must actually be in the source address.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} field   the field's label, e.g. 'Give token' / 'Get token'
 * @param {{chainId: string, chainLabel: string, tick: string}} target
 */
export async function selectNamedToken(page, field, { chainId, chainLabel, tick }) {
    const main = page.getByRole('main');
    const trigger = () => main.getByRole('button', { name: new RegExp(`^${field}:`) }).first();
    await expect(trigger(), `no "${field}" token field on this screen`)
        .toBeVisible({ timeout: 30_000 });

    // Already showing this chain's asset: nothing to do. Anchored on the whole
    // name so a tick that merely CONTAINS the chain name cannot satisfy it.
    const selected = (await trigger().getAttribute('aria-label')) || '';
    if (selected === `${field}: ${tick} on ${chainLabel}`) return;

    await trigger().click();

    const search = page.getByLabel('Search coins or tokens');
    await expect(search, `the "${field}" field did not open the asset picker`)
        .toBeVisible({ timeout: 30_000 });
    // Filtering is not cosmetic here: the held list is cross-chain, and on the
    // get side the "On the platform" section only appears AT ALL once a tick
    // has been typed, because discovery is a search.
    await search.fill(tick);

    const row = page.locator(`[data-balance-key="${chainId}:${tick}"]`).first();
    await expect(row, `the asset picker lists no ${tick} on ${chainLabel}. On the GIVE side that `
        + 'means the source address does not hold it; on the GET side it means platform discovery '
        + 'returned nothing, which is a venue answer rather than a wallet one')
        .toBeVisible({ timeout: 30_000 });
    await row.click();

    // Assert the selection took, for the same reason the chain helper does:
    // the picker closes on click either way, so an unasserted click is a
    // silent wrong-chain run.
    await expect(trigger(), `the "${field}" field did not settle on ${tick} / ${chainLabel}`)
        .toHaveAttribute('aria-label', `${field}: ${tick} on ${chainLabel}`, { timeout: 15_000 });
}
