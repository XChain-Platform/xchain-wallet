// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { ToggleRow } from './settings/_settingsPrimitives.jsx';

/**
 * Per-form opt-in to pay the protocol fee in the native coin (BTC/LTC/DOGE) at the USD-equivalent,
 * instead of debiting XCHAIN. A native-coin fee is a REAL on-chain payment that is forfeited if the
 * action is rejected (no refund), so this is a deliberate per-submission choice. Dumb + controlled:
 * the authoritative price/validity check runs at submit time in `applyNativeFeePreflight`, which
 * surfaces `NativeFeeForfeitError` when the action can't be priced. Renders nothing when `coinTicker`
 * is empty (custom/unknown chains that do not offer native-coin fee payment).
 *
 * Mount this on any QUOTABLE authoring action. Per the indexer's classifyFeeQuoteAction
 * (xchain-indexer/src/actions.js), every action is quotable EXCEPT the denied set
 * {DEPLOY, EXECUTE, XEXEC, BATCH} and the exempt settlement/emitted set {COINPAY, DISPENSE,
 * *_MATCH, *_EXPIRE, DISPENSER_CLOSE, CROSS_SETTLE, XCALL, ATTEST}; denied/exempt actions
 * reject the flag as unsupported. Forms hold the opt-in via the useNativeFee hook.
 *
 * @param {object} props
 * @param {boolean} props.checked
 * @param {(next: boolean) => void} props.onChange
 * @param {string} props.coinTicker   Native coin ticker (BTC/LTC/DOGE); empty hides the toggle.
 * @param {boolean} [props.disabled]
 */
export function NativeFeeToggle({ checked, onChange, coinTicker, disabled = false }) {
    if (!coinTicker) return null;
    return (
        <ToggleRow
            label={`Pay protocol fee in ${coinTicker} instead of XCHAIN`}
            hint="The fee is sent on-chain and is not refunded if the network rejects this transaction."
            checked={!!checked}
            onChange={onChange}
            disabled={disabled}
        />
    );
}
