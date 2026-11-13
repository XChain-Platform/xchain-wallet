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
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/routes.js';

/**
 * Standard own-address selector: the full change-address screen
 * (search, network dropdown, All / Normal / Imported / Misc segments,
 * add-address) in picker mode. Every From/source AddressField routes
 * here; tapping a row hands the address record back to the calling
 * form, and an address added via the +-menu appears in the list for
 * immediate selection.
 *
 * The network dropdown is seeded to the calling form's chain so the
 * relevant addresses show first. When the user widens it and picks an
 * address on another chain, `onChainChange` runs first so the form moves its
 * Network to that chain before the address fills in. A form bound to one
 * chain (a contract, a dispenser, a multisig record) passes `lockNetwork`:
 * the list stays on that chain and the switch to other networks is hidden,
 * so no pick can move the form off its chain. A form that passes no
 * `onChainChange` cannot follow a pick to another chain, so it is locked the
 * same way rather than handed an address its Network does not match.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {string | null} [props.chainId]     seeds the network filter
 * @param {string} [props.title]
 * @param {(address: any) => void} props.onPick
 * @param {(chainId: string) => void} [props.onChainChange]
 * @param {boolean} [props.lockNetwork]       hides the network switch and keeps the list on `chainId`
 * @param {(address: any, chainId: string) => string | null} [props.unavailableReason]   a non-empty reason disables that address row and shows why
 * @param {() => void} props.onBack
 * @param {Array<{ key: string, label: string, sublabel?: string, onSelect: () => void }>} [props.pickerActions]   extra rows above the list (see AddressList)
 * @param {Record<string, boolean>} [props.addressUsageByKey] chain-and-address keyed receive usage
 * @param {'small' | 'full'} [props.variant]  legacy, unused (AddressList derives its own)
 * @param {any[]} [props.addresses]           legacy, unused
 */
export function OwnAddressPickerScreen({
    walletId,
    accountId,
    chainId,
    title = t('routes.addressList.chooseAddress'),
    onPick,
    onChainChange,
    lockNetwork = false,
    unavailableReason,
    onBack,
    pickerActions,
    addressUsageByKey,
}) {
    return (
        <AddressList
            walletId={walletId}
            accountId={accountId}
            onBack={onBack}
            pickerMode
            title={title}
            onPick={(address, pickedChainId) => {
                if (pickedChainId && pickedChainId !== chainId) onChainChange?.(pickedChainId);
                onPick(address);
            }}
            pickerActions={pickerActions}
            addressUsageByKey={addressUsageByKey}
            networkFilter={chainId ? coinFromChainId(chainId) : 'all'}
            networkLocked={Boolean((lockNetwork || typeof onChainChange !== 'function') && chainId)}
            pickerUnavailableReason={unavailableReason}
        />
    );
}
