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
// the large input, the in-field Max icon, and the footer row
// (fiat/coin swap toggle + caller-supplied right-hand status). The
// canonical amount is always coin-scale; when the user toggles to
// fiat the input edits `fiatAmount` and the parent derives the coin
// amount via priceLookup.

import { useEffect, useRef, useState } from 'react';
import { Button, FieldIconButton, Input, Icon } from '@xchain-wallet/core/ui';
import {
    dropFieldGrouping,
    formatWithThousands,
    normalizeAmountFieldInput,
} from '../utils/amountFormat.js';
import { coinToFiatExact } from '../../flows/priceLookup.js';
import { formatFiat } from './BalanceList.jsx';
import styles from './AmountField.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/send.js';

// No edit in progress; any decimal limit (a number or null) differs from it.
const NOT_EDITING = Symbol('not-editing');

function decimalPlacesMessage(limit) {
    return `Amount can have at most ${limit} decimal places.`;
}

function fractionDigits(amount) {
    const text = amount == null ? '' : String(amount);
    const dot = text.indexOf('.');
    return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Pads a plain decimal amount with trailing zeros to the asset's decimal
 * places ("1" at 8 reads "1.00000000"). Display only: the caller keeps the
 * amount it passed. Empty, non-decimal or already full amounts come back as
 * given. A zero limit removes only a trailing decimal separator; a real
 * fractional value stays intact for precision validation. A null limit pads
 * nothing.
 *
 * @param {string} amount
 * @param {number | null} limit
 * @returns {string}
 */
export function padToDecimals(amount, limit) {
    const text = amount == null ? '' : String(amount);
    if (limit === 0 && /^\d+\.$/.test(text)) return text.slice(0, -1);
    if (!limit || !/^\d*\.?\d*$/.test(text) || !/\d/.test(text)) return text;
    const digits = fractionDigits(text);
    if (digits >= limit) return text;
    return `${text}${text.includes('.') ? '' : '.'}${'0'.repeat(limit - digits)}`;
}

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
 * @param {(error: string | null) => void} [props.onValidationError]
 * @param {() => void} [props.toggleAmountInputMode]
 * @param {import('react').RefObject<HTMLInputElement>} [props.inputRef]
 * @param {() => void} [props.onMax]                         when omitted, the in-field Max icon shows disabled so every amount field keeps the same shape
 * @param {boolean} [props.maxDisabled]                      grey out the Max icon (e.g. while balance is loading)
 * @param {boolean} [props.maxBusy] the Max amount is being priced (a native-coin Max is an encoder round trip, not arithmetic). Marks the icon busy and refuses a second click while the first is in flight.
 * @param {import('react').ReactNode} [props.balanceText]    right-hand footer text, typically "X.XX BTC available". Omit when meaningless (e.g. Receive).
 * @param {string} [props.hint]                           hint line under the input, forwarded to Input
 * @param {import('react').ReactNode} [props.help]         contextual help shown from the label-row InfoTip
 * @param {string} [props.error]                          caller-supplied validation error, forwarded to Input
 * @param {string} [props.id]                             id forwarded to the amount input
 * @param {number | string} [props.divisibility]          maximum coin-mode decimal places for the selected asset
 * @param {'sm' | 'md' | 'lg'} [props.size]                  control size, forwarded to the amount Input. Defaults to 'md'.
 * @param {boolean} [props.disabled]                         holds the input and its Max while the form is busy (composing)
 * @param {boolean} [props.optional]                         shows the shared Optional pill on the field label
 * @param {'true' | 'false'} [props.aria-required]        overrides the requirement assistive technology hears, for a field whose optional state is shown elsewhere (a section header)
 */
export function AmountField({
    id,
    label = t('send.fields.amount'),
    amount,
    size = 'md',
    fiatAmount = '',
    tick = '',
    fiatRate = null,
    fiatCurrency = 'USD',
    amountInputMode = 'coin',
    help,
    hint,
    error,
    divisibility,
    onAmountFieldChange,
    onValidationError,
    toggleAmountInputMode,
    inputRef,
    onMax,
    maxDisabled = false,
    maxBusy = false,
    balanceText,
    disabled = false,
    optional = false,
    'aria-required': ariaRequired,
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
    const hasDivisibility = divisibility !== null
        && divisibility !== undefined
        && String(divisibility).trim() !== '';
    const parsedDivisibility = hasDivisibility ? Number(divisibility) : Number.NaN;
    const decimalLimit = !isFiat && Number.isInteger(parsedDivisibility) && parsedDivisibility >= 0
        ? parsedDivisibility
        : null;

    // Typed text stays as typed until the field loses focus or the asset's
    // decimal places change; only then does the display pad the stored
    // amount. The marker holds the decimal limit the edit started under, so a
    // divisibility change ends the edit without an effect.
    const [editingAt, setEditingAt] = useState(NOT_EDITING);
    const editing = editingAt !== NOT_EDITING && editingAt === decimalLimit;
    const storedPrecisionError = decimalLimit !== null && fractionDigits(amount) > decimalLimit
        ? decimalPlacesMessage(decimalLimit)
        : '';
    const displayValue = formatWithThousands(
        isFiat || editing || storedPrecisionError ? inputValue : padToDecimals(amount, decimalLimit),
    );

    // The parent learns when its stored amount turns finer than the asset
    // allows (a new asset, a restored draft) and when that clears, so its own
    // submit gate matches the error the field shows.
    const previousDecimalLimit = useRef(decimalLimit);
    const reportedPrecisionError = useRef('');
    useEffect(() => {
        const precisionChanged = previousDecimalLimit.current !== decimalLimit;
        previousDecimalLimit.current = decimalLimit;
        if (precisionChanged) {
            setEditingAt(NOT_EDITING);
            setInputError('');
        }
        if (!precisionChanged && storedPrecisionError === reportedPrecisionError.current) return;
        reportedPrecisionError.current = storedPrecisionError;
        onValidationError?.(storedPrecisionError || null);
    }, [decimalLimit, storedPrecisionError]);

    const handleChange = (event) => {
        setEditingAt(decimalLimit);
        // A keystroke inside a grouped display ("1,000" plus a digit) leaves the
        // field's own group mark in the text; it is formatting, not input.
        const typed = /^(insertText|deleteContent)/.test(event.nativeEvent?.inputType || '');
        const rawValue = typed
            ? dropFieldGrouping(String(event.target.value), displayValue)
            : String(event.target.value);
        const cursorPos = event.target.selectionStart;
        const normalized = normalizeAmountFieldInput(rawValue, {
            unit: activeUnit,
            fiatCurrency: isFiat ? fiatCcy : null,
        });
        const shownValue = String(event.target.value);
        const normalizedCursor = typeof cursorPos === 'number'
            ? cursorPos === shownValue.length
                ? normalized?.length ?? null
                : shownValue.slice(0, cursorPos).replace(/[\s,]/g, '').length
            : null;

        if (normalized === null) {
            const message = 'Enter a valid decimal amount, such as 1,234.56 or 1.234,56.';
            setInputError(message);
            onValidationError?.(message);
            return;
        }
        const fraction = normalized.includes('.') ? normalized.split('.')[1] : '';
        if (decimalLimit !== null && fraction.length > decimalLimit) {
            const message = decimalPlacesMessage(decimalLimit);
            setInputError(message);
            onValidationError?.(message);
            return;
        }
        setInputError('');
        onValidationError?.(null);
        const usesDotDecimal = formatWithThousands('1.1').includes('.');
        onAmountFieldChange(normalized, usesDotDecimal ? normalizedCursor : null);
    };
    const showSwap = Boolean(fiatRate && toggleAmountInputMode);
    const hasFooter = showSwap || hasBalanceText;
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
                    optional={optional}
                    aria-required={ariaRequired}
                    help={help}
                    hint={hint}
                    error={inputError || storedPrecisionError || error}
                    inputMode="decimal"
                    value={displayValue}
                    onChange={handleChange}
                    onBlur={() => setEditingAt(NOT_EDITING)}
                    disabled={disabled || undefined}
                    autoComplete="off"
                    placeholder={decimalLimit === null
                        ? '0.00'
                        : decimalLimit === 0
                            ? '0'
                            : `0.${'0'.repeat(decimalLimit)}`}
                    // Max is a bare icon in the field's shared trailing slot; the
                    // Input reserves its room so typed digits stop before it.
                    fieldAction={(
                        <FieldIconButton
                            icon={<Icon.MaxIcon />}
                            label={t('components.amountField.useMaxAvailableAmount')}
                            onClick={() => {
                                if (!onMax) return;
                                setInputError('');
                                onValidationError?.(null);
                                onMax();
                            }}
                            disabled={!onMax || disabled || maxDisabled || maxBusy}
                            aria-busy={maxBusy || undefined}
                        />
                    )}
                />
            </div>
            {/* Rendered only when it has something to show: an empty footer still
                took its top margin (and, stacked on a phone, a row gap), so the
                form gap under a bare amount field read 8px wider than the rest. */}
            {hasFooter ? (
                <div className={styles.amountFooter}>
                    {showSwap ? (
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={<Icon.SwapIcon />}
                            onClick={() => {
                                setInputError('');
                                toggleAmountInputMode();
                            }}
                            aria-pressed={isFiat}
                            aria-label={isFiat
                                ? t('components.amountField.switchInputTo', { value: tickUpper || 'coin' })
                                : t('components.amountField.switchInputTo2', { fiatCcy })}
                        >
                            <span className={styles.amountSwapValue}>{derivedText}</span>
                        </Button>
                    ) : (
                        <span />
                    )}
                    <span className={styles.amountFooterRight}>
                        <span
                            role={hasBalanceText ? 'status' : undefined}
                            aria-live={hasBalanceText ? 'polite' : undefined}
                            aria-atomic={hasBalanceText ? 'true' : undefined}
                        >
                            {balanceText ?? null}
                        </span>
                    </span>
                </div>
            ) : null}
        </div>
    );
}
