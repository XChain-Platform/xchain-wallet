// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PriceAlertForm (§46). A compact "notify me when {coin} goes
// {above|below} {price}" form, shared by the Settings → Notifications
// manager and the native-coin TokenDetail "Set price alert" entry.
//
// Only native mainnet coins have price data (priceOracle's
// COINGECKO_SUPPORTED_CHAINS), so the coin selector lists just those. When
// `lockedChainId` is supplied (the TokenDetail entry already knows the
// coin) the selector is hidden. A soft warning appears when the target is
// already met given `currentPrice` (the alert is still valid, it'll just
// fire on the next check.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, Input, Select, StatusMessage } from '../../ui/index.js';
import { COINGECKO_SUPPORTED_CHAINS } from '../../flows/priceOracle.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/settings.js';

/** Native mainnet coins that have a price source. */
const MAINNET_PRICE_CHAINS = COINGECKO_SUPPORTED_CHAINS.filter((c) => c.endsWith('-mainnet'));

/** 'bitcoin-mainnet' → 'Bitcoin'. */
export function coinLabelForChain(chainId) {
    if (typeof chainId !== 'string' || !chainId) return String(chainId);
    const coin = chainId.split('-')[0];
    return coin ? coin.charAt(0).toUpperCase() + coin.slice(1) : chainId;
}

/**
 * @param {object} props
 * @param {(input: { chainId: string, direction: 'above'|'below', targetFiat: number, fiatCurrency: string }) => Promise<void> | void} props.onCreate
 * @param {string} [props.fiatCurrency]      display currency for the threshold (default 'usd')
 * @param {string} [props.lockedChainId]     when set, hides the coin selector and pins this coin
 * @param {number|null} [props.currentPrice] current spot price, drives the "already met" hint + prefill
 * @param {{ chainId: string, direction: 'above'|'below', targetFiat: number }} [props.initialAlert]
 * @param {() => void} [props.onCancel]
 */
export function PriceAlertForm({
    onCreate,
    fiatCurrency = 'usd',
    lockedChainId,
    currentPrice = null,
    initialAlert,
    onCancel,
}) {
    const disabledReasonId = `${useId()}-disabled-reason`;
    const cur = String(fiatCurrency || 'usd').toLowerCase();
    const editing = Boolean(initialAlert);
    const [chainId, setChainId] = useState(initialAlert?.chainId || lockedChainId || MAINNET_PRICE_CHAINS[0] || '');
    const [direction, setDirection] = useState(initialAlert?.direction || 'above');
    const [targetStr, setTargetStr] = useState(
        initialAlert?.targetFiat != null
            ? String(initialAlert.targetFiat)
            : currentPrice != null && Number.isFinite(currentPrice) ? String(roundForInput(currentPrice)) : '',
    );
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(/** @type {string|null} */ (null));
    const mountedRef = useRef(false);
    const inputVersionRef = useRef(0);
    // An alert saved for a coin that has since left the price list keeps its
    // own option, so editing it does not silently switch to the first coin.
    const unavailableChain = chainId && !MAINNET_PRICE_CHAINS.includes(chainId) ? chainId : null;

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const targetFiat = Number(targetStr);
    const valid = Boolean(chainId) && Number.isFinite(targetFiat) && targetFiat > 0;
    const invalidTarget = targetStr !== '' && !valid;
    // A bad price belongs to the price field, so it shows as that field's
    // error; the other reasons explain the disabled button below the row.
    const priceError = chainId && invalidTarget ? 'Enter a price greater than zero.' : null;
    const disabledReason = !chainId
        ? 'Choose a coin to continue.'
        : targetStr === ''
            ? t('settings.notifications.enterTargetPrice')
            : null;

    const alreadyMet = useMemo(() => {
        if (currentPrice == null || !Number.isFinite(currentPrice) || !valid) return false;
        return direction === 'above' ? currentPrice >= targetFiat : currentPrice <= targetFiat;
    }, [currentPrice, valid, direction, targetFiat]);

    const updateInput = (setter, value, currentValue) => {
        if (value === currentValue) return;
        inputVersionRef.current += 1;
        setErr(null);
        setter(value);
    };

    const submit = async () => {
        if (!valid || busy) return;
        const inputVersion = inputVersionRef.current;
        setBusy(true);
        setErr(null);
        try {
            await onCreate({ chainId, direction, targetFiat, fiatCurrency: cur });
            if (mountedRef.current && inputVersionRef.current === inputVersion && !editing) {
                setTargetStr('');
            }
        } catch (e) {
            if (mountedRef.current && inputVersionRef.current === inputVersion) {
                setErr(userFacingMessage(e, 'Could not save the alert. Try again.'));
            }
        } finally {
            if (mountedRef.current) setBusy(false);
        }
    };

    const symbol = cur === 'usd' ? '$' : '';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--xc-space-2)' }}>
                {lockedChainId ? (
                    <span style={{ fontWeight: 500 }}>{coinLabelForChain(lockedChainId)}</span>
                ) : (
                    <Select
                        aria-label={t('routes.addressList.coin')}
                        value={chainId}
                        onChange={(e) => updateInput(setChainId, e.target.value, chainId)}
                    >
                        {/* Native options remain because Select owns the listbox control, not its choices. */}
                        {unavailableChain ? (
                            <option value={unavailableChain}>
                                {t('settings.notifications.coinUnavailable', { coin: coinLabelForChain(unavailableChain) })}
                            </option>
                        ) : null}
                        {MAINNET_PRICE_CHAINS.map((c) => (
                            <option key={c} value={c}>{coinLabelForChain(c)}</option>
                        ))}
                    </Select>
                )}
                <Select
                    aria-label={t('components.priceAlertForm.direction')}
                    value={direction}
                    onChange={(e) => updateInput(setDirection, e.target.value, direction)}
                >
                    {/* Native options remain because Select owns the listbox control, not its choices. */}
                    <option value="above">{t('settings.notifications.risesAbove')}</option>
                    <option value="below">{t('settings.notifications.fallsBelow')}</option>
                </Select>
                {/* The currency symbol and its field wrap as one unit, so a narrow row never strands the symbol. */}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--xc-space-1)', flexWrap: 'nowrap' }}>
                <span aria-hidden="true">{symbol}</span>
                <Input
                    size="md"
                    type="text"
                    inputMode="decimal"
                    enterKeyHint="go"
                    aria-label={t('components.priceAlertForm.targetPrice')}
                    placeholder={t('components.placeOrderPanel.price')}
                    value={targetStr}
                    aria-invalid={invalidTarget}
                    aria-describedby={disabledReason ? disabledReasonId : undefined}
                    error={priceError || undefined}
                    onChange={(e) => updateInput(
                        setTargetStr,
                        normalizeDecimalEntry(e.target.value, targetStr),
                        targetStr,
                    )}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                    style={{ width: 110 }}
                />
                {!cur || cur === 'usd' ? null : <span aria-hidden="true">{cur.toUpperCase()}</span>}
                </span>
                <Button
                    type="button"
                    onClick={submit}
                    disabled={!valid || busy}
                    aria-describedby={disabledReason ? disabledReasonId : undefined}
                    size="md"
                    variant="primary"
                >
                    {busy ? t('send.saveRecipient.saving') : editing ? t('components.priceAlertForm.saveChanges') : t('components.priceAlertForm.addAlert')}
                </Button>
                {onCancel ? (
                    <Button
                        type="button"
                        onClick={onCancel}
                        size="md"
                        variant="secondary"
                    >
                        {t('common.cancel')}
                    </Button>
                ) : null}
            </div>
            {/* Why the button is off is said to assistive tech only: sighted users see an empty
                field and a disabled button, and a notice here would sit inside the indented
                alert block instead of at the content width. */}
            {disabledReason ? <span id={disabledReasonId} className="sr-only">{disabledReason}</span> : null}
            {alreadyMet ? (
                <StatusMessage variant="info">
                    {coinLabelForChain(chainId)} {t('components.priceAlertForm.isAlready')} {direction === 'above' ? t('components.priceAlertForm.above') : t('components.priceAlertForm.below')} {t('components.priceAlertForm.thatPriceThisAlertWill')}
                </StatusMessage>
            ) : null}
            <StatusMessage variant="error">{err}</StatusMessage>
        </div>
    );
}

function normalizeDecimalEntry(value, previous) {
    const stripped = String(value).replace(/,/g, '');
    return stripped === '' || /^\d*\.?\d*$/.test(stripped) ? stripped : previous;
}

/** Keep prefilled targets readable: whole dollars for big prices, 2dp for small. */
function roundForInput(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    if (n >= 100) return Math.round(n);
    if (n >= 1) return Math.round(n * 100) / 100;
    return Math.round(n * 1e6) / 1e6;
}
