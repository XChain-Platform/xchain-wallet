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

import { useState } from 'react';
import { Button, Input, Icon } from '@xchain-wallet/core/ui';
import { ClipboardPasteButton } from '../../ui/ClipboardPasteButton.jsx';
import { inspectFieldPaste } from '../../ui/Input.jsx';
import {
    formatWithThousands,
    normalizeAmountFieldInput,
} from '../utils/amountFormat.js';
import { coinToFiatExact } from '../../flows/priceLookup.js';
import { formatFiat } from './BalanceList.jsx';
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
 * @param {string} [props.error]                          caller-supplied validation error, forwarded to Input
 * @param {string} [props.id]                             id forwarded to the amount input
 * @param {number | string} [props.divisibility]          maximum coin-mode decimal places for the selected asset
 * @param {'md' | 'lg'} [props.size]                         field size, forwarded to the inner Input. Defaults to 'md' (compact) so it matches a form's other inputs; hero screens (Send/Receive) pass 'lg'.
 */
export function AmountField({
    id,
    label = 'Amount',
    amount,
    size = 'md',
    fiatAmount = '',
    tick = '',
    fiatRate = null,
    fiatCurrency = 'USD',
    amountInputMode = 'coin',
    hint,
    error,
    divisibility,
    onAmountFieldChange,
    toggleAmountInputMode,
    inputRef,
    onMax,
    maxDisabled = false,
    maxBusy = false,
    balanceText,
}) {
    const [inputError, setInputError] = useState('');
    const tickUpper = (typeof tick === 'string' ? tick : '').trim().toUpperCase();
    const fiatCcy = String(fiatRate?.fiatCurrency || fiatCurrency || 'USD').toUpperCase();
    const isFiat = Boolean(amountInputMode === 'fiat' && fiatRate);
    const activeUnit = isFiat ? fiatCcy : tickUpper;
    const otherUnit = isFiat ? tickUpper : fiatCcy;
    const inputValue = isFiat ? fiatAmount : amount;
    const hasBalanceText = balanceText !== null
        && balanceText !== undefined
        && balanceText !== false;
    const parsedDivisibility = Number(divisibility);
    const decimalLimit = !isFiat && Number.isInteger(parsedDivisibility) && parsedDivisibility >= 0
        ? parsedDivisibility
        : null;

    const handleChange = (event) => {
        const rawValue = String(event.target.value);
        const cursorPos = event.target.selectionStart;
        const normalized = normalizeAmountFieldInput(rawValue, {
            unit: activeUnit,
            fiatCurrency: isFiat ? fiatCcy : null,
        });
        const normalizedCursor = typeof cursorPos === 'number'
            ? cursorPos === rawValue.length
                ? normalized?.length ?? null
                : rawValue.slice(0, cursorPos).replace(/[\s,]/g, '').length
            : null;

        if (normalized === null) {
            setInputError('Enter a valid decimal amount, such as 1,234.56 or 1.234,56.');
            return;
        }
        const fraction = normalized.includes('.') ? normalized.split('.')[1] : '';
        if (decimalLimit !== null && fraction.length > decimalLimit) {
            setInputError(`Amount can have at most ${decimalLimit} decimal places.`);
            return;
        }
        setInputError('');
        const usesDotDecimal = formatWithThousands('1.1').includes('.');
        onAmountFieldChange(normalized, usesDotDecimal ? normalizedCursor : null);
    };
    const priceSourceLabel = fiatRate?.source === 'market' ? ' · DEX price' : '';

    let derivedText = '';
    if (isFiat) {
        derivedText = amount
            ? `≈ ${formatWithThousands(amount)} ${otherUnit}${priceSourceLabel}`.trim()
            : `≈ 0 ${otherUnit}${priceSourceLabel}`.trim();
    } else if (fiatRate) {
        const fiatValue = amount ? coinToFiatExact(amount, fiatRate) : null;
        derivedText = fiatValue != null
            ? `≈ ${formatFiat(fiatValue, fiatCcy)} ${otherUnit}${priceSourceLabel}`
            : `≈ ${formatFiat('0', fiatCcy)} ${otherUnit}${priceSourceLabel}`;
    }

    return (
        <div className={styles.amountBlock}>
            <div className={styles.amountFieldWrap}>
                <Input
                    ref={inputRef}
                    size={size}
                    id={id}
                    label={activeUnit ? `${label} (${activeUnit})` : label}
                    hint={hint}
                    error={inputError || error}
                    inputMode="decimal"
                    value={formatWithThousands(inputValue)}
                    onChange={handleChange}
                    autoComplete="off"
                    placeholder="0.00"
                    style={onMax ? { paddingInlineEnd: '64px' } : undefined}
                />
                {onMax ? (
                    <Button
                        variant="primary"
                        size="sm"
                        icon={null}
                        onClick={() => {
                            setInputError('');
                            onMax();
                        }}
                        disabled={maxDisabled || maxBusy}
                        aria-busy={maxBusy || undefined}
                        aria-label="Use max available amount"
                        style={{
                            position: 'absolute',
                            insetInlineEnd: 'var(--xc-space-2)',
                            bottom: size === 'lg' ? '10px' : '4px',
                        }}
                    >
                        Max
                    </Button>
                ) : null}
            </div>
            <div className={styles.amountFooter}>
                {fiatRate && toggleAmountInputMode ? (
                    <button
                        type="button"
                        className={styles.amountUnitSwap}
                        onClick={() => {
                            setInputError('');
                            toggleAmountInputMode();
                        }}
                        aria-pressed={isFiat}
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
                <span className={styles.amountFooterRight}>
                    <ClipboardPasteButton
                        onPaste={(text) => {
                            const inspected = inspectFieldPaste(text);
                            if (!inspected.ok) {
                                setInputError(inspected.error);
                                return;
                            }
                            handleChange({
                                target: {
                                    value: inspected.value,
                                    selectionStart: inspected.value.length,
                                },
                            });
                        }}
                    />
                    <span
                        role={hasBalanceText ? 'status' : undefined}
                        aria-live={hasBalanceText ? 'polite' : undefined}
                        aria-atomic={hasBalanceText ? 'true' : undefined}
                    >
                        {balanceText ?? null}
                    </span>
                </span>
            </div>
        </div>
    );
}
