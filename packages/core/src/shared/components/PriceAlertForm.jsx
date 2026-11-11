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
// The network selector starts with the native mainnet coins supported by the
// price oracle. A wallet-scoped token picker beside it adds held tokens from
// that network. When `lockedChainId` is supplied, TokenDetail already knows
// the asset and the selectors are hidden. A soft warning appears when the
// target is already met given `currentPrice`.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, Icon, Input, Select, StatusMessage } from '../../ui/index.js';
import { COINGECKO_SUPPORTED_CHAINS } from '../../flows/priceOracle.js';
import { defaultRegistry } from '../../registry/index.js';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useTickFiatRate } from '../hooks/useFiatRate.js';
import { TokenField } from './TokenField.jsx';
import { TokenPicker } from '../routes/TokenPicker.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/settings.js';

/** Native mainnet coins that have a price source. */
const MAINNET_PRICE_CHAINS = COINGECKO_SUPPORTED_CHAINS.filter((c) => c.endsWith('-mainnet'));
const chainRegistry = defaultRegistry();

/** 'bitcoin-mainnet' → 'Bitcoin'. */
export function coinLabelForChain(chainId) {
    if (typeof chainId !== 'string' || !chainId) return String(chainId);
    const coin = chainId.split('-')[0];
    return coin ? coin.charAt(0).toUpperCase() + coin.slice(1) : chainId;
}

/**
 * @param {object} props
 * @param {(input: { chainId: string, tick?: string, direction: 'above'|'below', targetFiat: number, fiatCurrency: string }) => Promise<void> | void} props.onCreate
 * @param {string} [props.walletId]          wallet whose held tokens the picker lists
 * @param {string} [props.fiatCurrency]      display currency for the threshold (default 'usd')
 * @param {string} [props.lockedChainId]     when set, hides the coin selector and pins this coin
 * @param {string} [props.lockedTick]        when set with lockedChainId, pins this token
 * @param {boolean} [props.allowCoingeckoFallback] honor the price-data privacy setting
 * @param {number|null} [props.currentPrice] current spot price, drives the "already met" hint + prefill
 * @param {{ chainId: string, direction: 'above'|'below', targetFiat: number }} [props.initialAlert]
 * @param {() => void} [props.onCancel]
 * @param {(screen: import('react').ReactNode | null) => void} [props.onTokenPickerScreenChange]
 */
export function PriceAlertForm({
    onCreate,
    walletId,
    fiatCurrency = 'usd',
    lockedChainId,
    lockedTick,
    allowCoingeckoFallback = true,
    currentPrice = null,
    initialAlert,
    onCancel,
    onTokenPickerScreenChange,
}) {
    const disabledReasonId = `${useId()}-disabled-reason`;
    const cur = String(fiatCurrency || 'usd').toLowerCase();
    const editing = Boolean(initialAlert);
    const [chainId, setChainId] = useState(initialAlert?.chainId || lockedChainId || MAINNET_PRICE_CHAINS[0] || '');
    const [tick, setTick] = useState(
        String(initialAlert?.tick || lockedTick || '').trim().toUpperCase(),
    );
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
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
    const descriptor = chainRegistry.get(chainId);
    const nativeTicker = tickerForDescriptor(descriptor);
    const tickFiatRate = useTickFiatRate({
        chainCoin: descriptor?.coin,
        tick,
        nativeTicker,
        fiatCurrency: cur.toUpperCase(),
        allowCoingeckoFallback,
        enabled: Boolean(chainId) && currentPrice == null,
    });
    const resolvedCurrentPrice = Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0
        ? Number(currentPrice)
        : Number.isFinite(Number(tickFiatRate?.rate)) && Number(tickFiatRate.rate) > 0
            ? Number(tickFiatRate.rate)
            : null;
    const tokenHasNoPrice = Boolean(tick) && resolvedCurrentPrice === null;

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const targetFiat = Number(targetStr);
    const targetValid = Number.isFinite(targetFiat) && targetFiat > 0;
    const valid = Boolean(chainId) && targetValid && !tokenHasNoPrice;
    const invalidTarget = targetStr !== '' && !targetValid;
    // A bad price belongs to the price field, so it shows as that field's
    // error; the other reasons explain the disabled button below the row.
    const priceError = chainId && invalidTarget ? 'Enter a price greater than zero.' : null;
    const noPriceMessage = tokenHasNoPrice
        ? t('components.priceAlertForm.noMarketPrice', { tick })
        : null;
    const disabledReason = !chainId
        ? 'Choose a coin to continue.'
        : noPriceMessage
            ? noPriceMessage
            : targetStr === ''
                ? t('settings.notifications.enterTargetPrice')
                : null;

    const alreadyMet = useMemo(() => {
        if (resolvedCurrentPrice == null || !valid) return false;
        return direction === 'above' ? resolvedCurrentPrice >= targetFiat : resolvedCurrentPrice <= targetFiat;
    }, [resolvedCurrentPrice, valid, direction, targetFiat]);

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
            await onCreate({
                chainId,
                ...(tick ? { tick } : {}),
                direction,
                targetFiat,
                fiatCurrency: cur,
            });
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

    const closeTokenPicker = () => {
        setTokenPickerOpen(false);
        onTokenPickerScreenChange?.(null);
    };
    const tokenPickerScreen = (
        <TokenPicker
            purpose="send"
            walletId={walletId}
            chainIdFilter={chainId}
            kindFilter="all"
            title={t('components.priceAlertForm.chooseAsset')}
            onSelect={(selection) => {
                const selectedChainId = String(selection.chainId || chainId);
                const selectedDescriptor = chainRegistry.get(selectedChainId);
                const selectedTick = String(selection.tick || '').trim().toUpperCase();
                const selectedNativeTicker = tickerForDescriptor(selectedDescriptor).toUpperCase();
                inputVersionRef.current += 1;
                setErr(null);
                setChainId(selectedChainId);
                setTick(selection.kind === 'native' || selectedTick === selectedNativeTicker ? '' : selectedTick);
                setTargetStr('');
                closeTokenPicker();
            }}
            onBack={closeTokenPicker}
        />
    );

    if (tokenPickerOpen) {
        return onTokenPickerScreenChange ? null : tokenPickerScreen;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)' }}>
            {/* Keep the coin, threshold controls, and actions on three fixed rows.
                The form stays compact without merging the groups on wider screens. */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--xc-space-2)' }}>
                <div data-row="coin" style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 'var(--xc-space-2)', minWidth: 'fit-content' }}>
                    {lockedChainId ? (
                        <span style={{ fontWeight: 500 }}>{tick || coinLabelForChain(lockedChainId)}</span>
                    ) : (
                        <>
                            <Select
                                aria-label={t('routes.addressList.coin')}
                                value={chainId}
                                onChange={(e) => {
                                    const nextChainId = e.target.value;
                                    updateInput(setChainId, nextChainId, chainId);
                                    setTick('');
                                    setTargetStr('');
                                }}
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
                            <TokenField
                                label=""
                                value={tick ? { chainId, tick } : null}
                                placeholder={t('components.priceAlertForm.chooseHeldToken')}
                                onOpenPicker={() => {
                                    setTokenPickerOpen(true);
                                    onTokenPickerScreenChange?.(tokenPickerScreen);
                                }}
                                disabled={!walletId || !chainId}
                            />
                        </>
                    )}
                </div>
                <span data-row="filters" style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 'var(--xc-space-2)', minWidth: 'fit-content' }}>
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
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--xc-space-1)', flexWrap: 'nowrap', flex: '1 1 0', minWidth: 0 }}>
                    <span aria-hidden="true">{symbol}</span>
                    <Input
                        size="md"
                        type="text"
                        inputMode="decimal"
                        enterKeyHint="go"
                        aria-label={t('components.priceAlertForm.targetPrice')}
                        placeholder={resolvedCurrentPrice == null
                            ? t('components.placeOrderPanel.price')
                            : String(roundForInput(resolvedCurrentPrice))}
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
                    {resolvedCurrentPrice == null ? null : (
                        <span style={{ color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-xs)', whiteSpace: 'nowrap' }}>
                            {t('components.priceAlertForm.currentPrice', {
                                price: formatCurrentPrice(resolvedCurrentPrice, cur),
                            })}
                        </span>
                    )}
                </span>
                <div data-row="action" style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 'var(--xc-space-2)', minWidth: 'fit-content', whiteSpace: 'nowrap' }}>
                    <Button
                        type="button"
                        onClick={submit}
                        disabled={!valid || busy}
                        aria-describedby={disabledReason ? disabledReasonId : undefined}
                        size="md"
                        variant="success"
                        icon={<Icon.CheckIcon />}
                    >
                        {busy ? t('send.saveRecipient.saving') : t('components.priceAlertForm.savePriceAlert')}
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
            </div>
            {/* Why the button is off is said to assistive tech only: sighted users see an empty
                field and a disabled button, and a notice here would sit inside the indented
                alert block instead of at the content width. */}
            {disabledReason && !noPriceMessage ? <span id={disabledReasonId} className="sr-only">{disabledReason}</span> : null}
            {noPriceMessage ? <div id={disabledReasonId}><StatusMessage variant="info">{noPriceMessage}</StatusMessage></div> : null}
            {alreadyMet ? (
                <StatusMessage variant="info">
                    {tick || coinLabelForChain(chainId)} {t('components.priceAlertForm.isAlready')} {direction === 'above' ? t('components.priceAlertForm.above') : t('components.priceAlertForm.below')} {t('components.priceAlertForm.thatPriceThisAlertWill')}
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

function formatCurrentPrice(value, currency) {
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: String(currency || 'usd').toUpperCase(),
            maximumFractionDigits: value < 1 ? 6 : 2,
        }).format(value);
    } catch {
        return `${value} ${String(currency || 'usd').toUpperCase()}`;
    }
}
