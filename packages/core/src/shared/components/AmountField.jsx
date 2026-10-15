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

import { useLayoutEffect, useRef, useState } from 'react';
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
import { t } from '../../i18n/index.js';

// The space kept between typed digits and the first action: the same 4px
// (--xc-space-1) the actions keep from the field border.
const ACTIONS_TEXT_GAP_PX = 4;

/**
 * Writes `--amount-actions-room` on the field: how far in from the input's
 * end edge its in-field actions (Paste, and Max when shown) really reach,
 * plus a small gap. The input's end padding is at least this, so typed
 * digits stop before the actions. The stylesheet lanes assume default-size
 * labels; Paste and Max grow with the text size, and at 130 percent text the
 * digits already ran under Paste.
 *
 * @param {HTMLElement | null} wrap     the field wrapper, which owns the property
 * @param {HTMLElement | null} input    the amount input
 * @param {Array<HTMLElement | null>} actions  the in-field action buttons
 * @returns {number | null} the room written, or null when nothing was measured
 */
export function syncAmountActionsRoom(wrap, input, actions) {
    if (!wrap || !input) return null;
    const box = input.getBoundingClientRect();
    const rects = actions.filter(Boolean)
        .map((action) => action.getBoundingClientRect())
        .filter((rect) => rect.width > 0);
    if (box.width <= 0 || rects.length === 0) return null;
    const rtl = getComputedStyle(wrap).direction === 'rtl';
    const reach = rtl
        ? Math.max(...rects.map((rect) => rect.right)) - box.left
        : box.right - Math.min(...rects.map((rect) => rect.left));
    const room = Math.ceil(reach + ACTIONS_TEXT_GAP_PX);
    wrap.style.setProperty('--amount-actions-room', `${room}px`);
    return room;
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
 * @param {() => void} [props.onMax]                         when omitted, the inline Max button is hidden
 * @param {boolean} [props.maxDisabled]                      grey out the Max button (e.g. while balance is loading)
 * @param {boolean} [props.maxBusy] the Max amount is being priced (a native-coin Max is an encoder round trip, not arithmetic). Marks the button busy and refuses a second click while the first is in flight.
 * @param {import('react').ReactNode} [props.balanceText]    right-hand footer text, typically "X.XX BTC available". Omit when meaningless (e.g. Receive).
 * @param {string} [props.hint]                           hint line under the input, forwarded to Input
 * @param {string} [props.error]                          caller-supplied validation error, forwarded to Input
 * @param {string} [props.id]                             id forwarded to the amount input
 * @param {number | string} [props.divisibility]          maximum coin-mode decimal places for the selected asset
 * @param {'sm' | 'md' | 'lg'} [props.size]                  control size, forwarded to the amount Input and inline Max Button. Defaults to 'md'.
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
}) {
    const [inputError, setInputError] = useState('');
    const wrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const pasteSlotRef = useRef(/** @type {HTMLSpanElement | null} */ (null));
    const maxRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
    const hasMax = Boolean(onMax);

    useLayoutEffect(() => {
        const wrap = wrapRef.current;
        const input = wrap?.querySelector('input') ?? null;
        const actions = () => [pasteSlotRef.current?.querySelector('button') ?? null, maxRef.current];
        const sync = () => syncAmountActionsRoom(wrap, input, actions());
        sync();
        if (!input || typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver(sync);
        observer.observe(input);
        actions().filter(Boolean).forEach((action) => observer.observe(action));
        return () => observer.disconnect();
    }, [hasMax]);
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
            const message = 'Enter a valid decimal amount, such as 1,234.56 or 1.234,56.';
            setInputError(message);
            onValidationError?.(message);
            return;
        }
        const fraction = normalized.includes('.') ? normalized.split('.')[1] : '';
        if (decimalLimit !== null && fraction.length > decimalLimit) {
            const message = `Amount can have at most ${decimalLimit} decimal places.`;
            setInputError(message);
            onValidationError?.(message);
            return;
        }
        setInputError('');
        onValidationError?.(null);
        const usesDotDecimal = formatWithThousands('1.1').includes('.');
        onAmountFieldChange(normalized, usesDotDecimal ? normalizedCursor : null);
    };
    // The Paste and Max buttons sit over the field at fixed lanes sized for the
    // English labels. A longer translation widens a button past its lane and the
    // two overlap, so each lane grows to the measured button. English measures
    // narrower than the default lane, so its layout is unchanged.
    const [measured, setMeasured] = useState({ max: 0, paste: 0 });
    useLayoutEffect(() => {
        const root = wrapRef.current;
        if (!root) return;
        const widthOf = (selector) => Math.ceil(root.querySelector(selector)?.getBoundingClientRect().width || 0);
        const next = { max: widthOf(`.${styles.maxAction}`), paste: widthOf(`.${styles.pasteAction} button`) };
        setMeasured((prev) => (prev.max === next.max && prev.paste === next.paste ? prev : next));
    });
    const lane = (px) => (px > 0
        ? `max(calc(var(--amount-control-height) + var(--xc-space-8)), calc(${px}px + var(--xc-space-2)))`
        : undefined);
    const maxLane = lane(measured.max);
    const pasteLane = lane(measured.paste);

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
            <div
                ref={wrapRef}
                className={[
                    styles.amountFieldWrap,
                    styles[size] || '',
                    onMax ? styles.hasMax : '',
                ].filter(Boolean).join(' ')}
                style={(onMax ? maxLane : pasteLane) ? { '--amount-action-width': onMax ? maxLane : pasteLane } : undefined}
            >
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
                    // Paste sits one action lane in from Max, so two lanes
                    // clear both at default text; a 320px field keeps 120px for
                    // digits. Larger text widens the actions, and the measured
                    // room (syncAmountActionsRoom) then holds the digits clear.
                    style={{
                        paddingInlineEnd: onMax
                            ? (pasteLane
                                ? `max(calc(var(--amount-action-width) + ${pasteLane}), var(--amount-actions-room, 0px))`
                                : 'max(calc(var(--amount-action-width) * 2), var(--amount-actions-room, 0px))')
                            : 'max(calc(var(--amount-action-width) + var(--xc-space-2)), var(--amount-actions-room, 0px))',
                    }}
                />
                <span className={styles.pasteAction} ref={pasteSlotRef}>
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
                </span>
                {onMax ? (
                    <Button
                        variant="primary"
                        size={size}
                        ref={maxRef}
                        className={styles.maxAction}
                        icon={null}
                        onClick={() => {
                            setInputError('');
                            onValidationError?.(null);
                            onMax();
                        }}
                        disabled={maxDisabled || maxBusy}
                        aria-busy={maxBusy || undefined}
                        aria-label={t('components.amountField.useMaxAvailableAmount')}
                    >
                        {t('components.amountField.max')}
                    </Button>
                ) : null}
            </div>
            {/* Rendered only when it has something to show: an empty footer still
                took its top margin (and, stacked on a phone, a row gap), so the
                form gap under a bare amount field read 8px wider than the rest. */}
            {hasFooter ? (
                <div className={styles.amountFooter}>
                    {showSwap ? (
                        <Button
                            variant="ghost"
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
