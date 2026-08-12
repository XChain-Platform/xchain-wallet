// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shared "big amount" entry block used by Send and Receive. Bundles
// the large input, the optional inline Max button, and the footer row
// (fiat/coin swap toggle + caller-supplied right-hand status). The
// canonical amount is always coin-scale; when the user toggles to
// fiat the input edits `fiatAmount` and the parent derives the coin
// amount via priceLookup.

import { Input, Icon } from '@xchain-wallet/core/ui';
import { formatWithThousands } from '../utils/amountFormat.js';
import { coinToFiat } from '../../flows/priceLookup.js';
import styles from './AmountField.module.css';

/**
 * @param {object} props
 * @param {string} [props.label]                             field label; defaults to "Amount". The active unit is appended either way.
 * @param {string} props.amount                              canonical coin-scale amount (always)
 * @param {string} [props.fiatAmount]                        raw text in the fiat input mode; ignored when `amountInputMode === 'coin'`
 * @param {string} [props.tick]                              ticker shown in the label when in coin mode (e.g. 'BTC')
 * @param {{ fiatCurrency?: string, rate?: number } | null} [props.fiatRate] rate for ONE UNIT OF `tick`, not for the chain coin (`useTickFiatRate` returns exactly this). When null, the fiat toggle and the ≈ preview are hidden, which is the correct render for a tick nothing can price.
 * @param {string} [props.fiatCurrency]                      fallback fiat code when `fiatRate.fiatCurrency` is missing
 * @param {'coin' | 'fiat'} [props.amountInputMode]
 * @param {(rawValue: string, cursorPos: number | null) => void} props.onAmountFieldChange
 * @param {() => void} [props.toggleAmountInputMode]
 * @param {import('react').RefObject<HTMLInputElement>} [props.inputRef]
 * @param {() => void} [props.onMax]                         when omitted, the inline Max button is hidden
 * @param {boolean} [props.maxDisabled]                      grey out the Max button (e.g. while balance is loading)
 * @param {boolean} [props.maxBusy] the Max amount is being priced (a native-coin Max is an encoder round trip, not arithmetic). Marks the button busy and refuses a second click while the first is in flight.
 * @param {import('react').ReactNode} [props.balanceText]    right-hand footer text, typically "X.XX BTC available". Omit when meaningless (e.g. Receive).
 * @param {string} [props.hint]                           hint line under the input, forwarded to Input
 * @param {'md' | 'lg'} [props.size]                         field size, forwarded to the inner Input. Defaults to 'md' (compact) so it matches a form's other inputs; hero screens (Send/Receive) pass 'lg'.
 */
export function AmountField({
    label = 'Amount',
    amount,
    size = 'md',
    fiatAmount = '',
    tick = '',
    fiatRate = null,
    fiatCurrency = 'USD',
    amountInputMode = 'coin',
    hint,
    onAmountFieldChange,
    toggleAmountInputMode,
    inputRef,
    onMax,
    maxDisabled = false,
    maxBusy = false,
    balanceText,
}) {
    const tickUpper = (typeof tick === 'string' ? tick : '').trim().toUpperCase();
    const fiatCcy = fiatRate?.fiatCurrency || fiatCurrency;
    const isFiat = amountInputMode === 'fiat' && fiatRate;
    const activeUnit = isFiat ? fiatCcy : tickUpper;
    const otherUnit = isFiat ? tickUpper : fiatCcy;
    const inputValue = isFiat ? fiatAmount : amount;

    let derivedText = '';
    if (isFiat) {
        derivedText = amount
            ? `≈ ${formatWithThousands(amount)} ${otherUnit}`.trim()
            : `≈ 0 ${otherUnit}`.trim();
    } else if (fiatRate) {
        const fiatN = amount ? coinToFiat(amount, fiatRate) : null;
        derivedText = fiatN != null
            ? `≈ ${formatWithThousands(fiatN.toFixed(2))} ${otherUnit}`
            : `≈ 0.00 ${otherUnit}`;
    }

    return (
        <div className={styles.amountBlock}>
            <div className={styles.amountFieldWrap} data-size={size}>
                <Input
                    ref={inputRef}
                    size={size}
                    label={activeUnit ? `${label} (${activeUnit})` : label}
                    hint={hint}
                    inputMode="decimal"
                    value={formatWithThousands(inputValue)}
                    onChange={(e) => onAmountFieldChange(e.target.value, e.target.selectionStart)}
                    autoComplete="off"
                    placeholder="0.00"
                    style={onMax ? { paddingRight: '64px' } : undefined}
                />
                {onMax ? (
                    <button
                        type="button"
                        className={styles.amountMaxInline}
                        onClick={onMax}
                        disabled={maxDisabled}
                        aria-busy={maxBusy || undefined}
                        aria-label="Use max available amount"
                    >
                        Max
                    </button>
                ) : null}
            </div>
            <div className={styles.amountFooter}>
                {fiatRate && toggleAmountInputMode ? (
                    <button
                        type="button"
                        className={styles.amountUnitSwap}
                        onClick={toggleAmountInputMode}
                        aria-label={isFiat
                            ? `Switch input to ${tickUpper || 'coin'}`
                            : `Switch input to ${fiatCcy}`}
                    >
                        <Icon.SwapIcon />
                        <span>{derivedText}</span>
                    </button>
                ) : (
                    <span />
                )}
                <span className={styles.amountFooterRight}>{balanceText ?? null}</span>
            </div>
        </div>
    );
}
