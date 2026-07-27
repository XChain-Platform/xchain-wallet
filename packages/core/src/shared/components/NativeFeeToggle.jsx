// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { ToggleRow, ROW, ROW_HINT } from './settings/_settingsPrimitives.jsx';
import { NATIVE_FEE_UNVERIFIED_NOTICE } from '../../sdk/nativeFeePreflight.js';

/**
 * How this action's protocol fee gets paid, in the one place a form shows it.
 *
 * On Bitcoin this is a per-submission choice: pay the fee from an XCHAIN
 * balance (the default) or with a native-coin output at the USD equivalent.
 * On every other chain there is no XCHAIN fee lane, so the native-coin output
 * is the only way to pay and `mandatory` turns the row into a plain statement
 * of what will happen . Offering a choice there was worse than
 * useless: unticking it produced a transaction the network rejects for
 * `insufficient fee (native coin output required)` after the miner fee was
 * already spent.
 *
 * Either way the native-coin fee is a REAL on-chain payment that is forfeited
 * if the action is rejected (no refund), so the hint stays on both variants.
 * Dumb + controlled: the authoritative price/validity check runs at submit
 * time in `applyNativeFeePreflight`, which surfaces `NativeFeeForfeitError`
 * when the action can't be priced. Renders nothing when `coinTicker` is empty
 * (custom/unknown chains, which do not offer native-coin fee payment).
 *
 * Mount this on any QUOTABLE authoring action. Per the indexer's
 * classifyFeeQuoteAction (xchain-indexer/src/actions.js), every action is
 * quotable EXCEPT the denied set {XEXEC, BATCH} and the exempt
 * settlement/emitted set {COINPAY, DISPENSE, *_MATCH, *_EXPIRE,
 * DISPENSER_CLOSE, CROSS_SETTLE, XCALL, ATTEST}; denied/exempt actions reject
 * the flag as unsupported. Forms hold the state via the useNativeFee hook,
 * which is also what sets `mandatory`.
 *
 * DEPLOY and EXECUTE sit in the denylist too but are NOT unquotable: 
 * gives them a schedule-priced quote with no verdict (`valid:null`), which is
 * payable, and on LTC/DOGE it is the only way they are payable at all. Their
 * forms pass `unverified` so the row says the amount is exact while acceptance
 * is not pre-judged. Do not set it anywhere else: on a verdict-bearing action
 * it would understate what the pre-flight actually checked.
 *
 * @param {object} props
 * @param {boolean} props.checked
 * @param {(next: boolean) => void} props.onChange
 * @param {string} props.coinTicker   Native coin ticker (BTC/LTC/DOGE); empty hides the row.
 * @param {boolean} [props.mandatory] Chain has no XCHAIN fee lane; no choice to offer.
 * @param {boolean} [props.unverified] Action is priced without a verdict (DEPLOY/EXECUTE).
 * @param {boolean} [props.disabled]
 */
export function NativeFeeToggle({
    checked, onChange, coinTicker, mandatory = false, unverified = false, disabled = false,
}) {
    if (!coinTicker) return null;
    const forfeitHint =
        'The fee is sent on-chain and is not refunded if the network rejects this transaction.'
        // Only when the fee is actually being paid in coin: on Bitcoin with the
        // toggle off the fee is an XCHAIN balance debit that costs nothing when
        // the action is rejected, so there is no unverified risk to warn about.
        + (unverified && (mandatory || checked) ? ` ${NATIVE_FEE_UNVERIFIED_NOTICE}` : '');

    if (mandatory) {
        return (
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>
                        {`Protocol fee is paid in ${coinTicker}`}
                    </span>
                    <span style={ROW_HINT}>
                        {`${coinTicker} is the only way to pay the protocol fee on this chain. ${forfeitHint}`}
                    </span>
                </div>
            </div>
        );
    }

    return (
        <ToggleRow
            label={`Pay protocol fee in ${coinTicker} instead of XCHAIN`}
            hint={forfeitHint}
            checked={!!checked}
            onChange={onChange}
            disabled={disabled}
        />
    );
}
