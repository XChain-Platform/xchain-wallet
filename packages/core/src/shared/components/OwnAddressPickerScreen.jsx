// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { AddressList } from '../routes/AddressList.jsx';
import { coinFromChainId } from './BalanceList.jsx';

/**
 * Standard own-address selector: the full change-address screen
 * (search, network dropdown, All / Normal / Imported / Misc segments,
 * add-address) in picker mode. Every From/source AddressField routes
 * here; tapping a row hands the address record back to the calling
 * form, and an address added via the +-menu appears in the list for
 * immediate selection.
 *
 * The network dropdown is seeded to the calling form's chain so the
 * relevant addresses show first.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {string | null} [props.chainId]     seeds the network filter
 * @param {string} [props.title]
 * @param {(address: any) => void} props.onPick
 * @param {() => void} props.onBack
 * @param {'small' | 'full'} [props.variant]  legacy, unused (AddressList derives its own)
 * @param {any[]} [props.addresses]           legacy, unused
 */
export function OwnAddressPickerScreen({
    walletId,
    accountId,
    chainId,
    title = 'Choose address',
    onPick,
    onBack,
}) {
    return (
        <AddressList
            walletId={walletId}
            accountId={accountId}
            onBack={onBack}
            pickerMode
            title={title}
            onPick={onPick}
            networkFilter={chainId ? coinFromChainId(chainId) : 'all'}
        />
    );
}
