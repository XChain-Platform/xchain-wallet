// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PriceAlertForm (§46): the body of the Add Price Alert and Edit Price Alert
// pages, built on the Form Standard (2026-11-14). One "Price alert" section:
// the Asset field that opens the Choose Asset page, a "Rises above / Falls
// below" themed dropdown with an icon per choice, the Target price in the
// display currency with the live price under it, and the line saying the
// alert fires once. The green full-width button with its icon saves.
//
// The form owns no screen: its host (the Price Alerts section, or the Token
// detail page) draws the Screen and the title. While the Choose Asset page
// is open the form keeps its state and hands that page up through
// `onTokenPickerScreenChange`; without that prop it returns the page itself.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon, IconSelect, Input, StatusMessage, useFormErrors } from '@xchain-wallet/core/ui';
import { defaultRegistry } from '../../registry/index.js';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { useTickFiatRate } from '../hooks/useFiatRate.js';
import { FormAction, FormFrame } from './formStandard/index.js';
import { TokenField } from './TokenField.jsx';
import { TokenPicker } from '../routes/TokenPicker.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/settings.js';
import '../../i18n/locales/en/shell.js';

const chainRegistry = defaultRegistry();

/** 'bitcoin-mainnet' → 'Bitcoin'. */
export function coinLabelForChain(chainId) {
    if (typeof chainId !== 'string' || !chainId) return String(chainId);
    const coin = chainId.split('-')[0];
    return coin ? coin.charAt(0).toUpperCase() + coin.slice(1) : chainId;
}

/** The ticker an alert's asset goes by: its token tick, else its chain's coin ticker. */
export function alertAssetTicker(chainId, tick) {
    const own = String(tick || '').trim().toUpperCase();
    if (own) return own;
    return String(tickerForDescriptor(chainRegistry.get(chainId)) || coinLabelForChain(chainId)).toUpperCase();
}

const TREND_PROPS = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: 'false',
};

/** A line rising to the right. */
export function TrendUpIcon() {
    return (
        <svg {...TREND_PROPS}>
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
        </svg>
    );
}

/** A line falling to the right. */
export function TrendDownIcon() {
    return (
        <svg {...TREND_PROPS}>
            <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
            <polyline points="16 17 22 17 22 11" />
        </svg>
    );
}

/**
 * @param {object} props
 * @param {(input: { chainId: string, tick?: string, direction: 'above'|'below', targetFiat: number, fiatCurrency: string }) => Promise<void> | void} props.onCreate
 * @param {string} [props.walletId]          wallet whose held tokens the picker lists
 * @param {string} [props.fiatCurrency]      display currency for the threshold (default 'usd')
 * @param {string} [props.initialChainId]    the asset chosen when the form opens (Token detail)
 * @param {string} [props.initialTick]       the token chosen with it; blank for the coin
 * @param {boolean} [props.allowCoingeckoFallback] honor the price-data privacy setting
 * @param {number|null} [props.currentPrice] current spot price when the host already has it
 * @param {{ chainId: string, tick?: string, direction: 'above'|'below', targetFiat: number }} [props.initialAlert] edits this alert
 * @param {(screen: import('react').ReactNode | null) => void} [props.onTokenPickerScreenChange]
 */
export function PriceAlertForm({
    onCreate,
    walletId,
    fiatCurrency = 'usd',
    initialChainId,
    initialTick,
    allowCoingeckoFallback = true,
    currentPrice = null,
    initialAlert,
    onTokenPickerScreenChange,
}) {
    const noteId = useId();
    const cur = String(fiatCurrency || 'usd').toLowerCase();
    const editing = Boolean(initialAlert);
    const [chainId, setChainId] = useState(initialAlert?.chainId || initialChainId || '');
    const [tick, setTick] = useState(String(initialAlert?.tick || initialTick || '').trim().toUpperCase());
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [direction, setDirection] = useState(initialAlert?.direction || 'above');
    const [targetStr, setTargetStr] = useState(
        initialAlert?.targetFiat != null ? String(initialAlert.targetFiat) : '',
    );
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(/** @type {string|null} */ (null));
    const formErrors = useFormErrors();
    const mountedRef = useRef(false);
    const inputVersionRef = useRef(0);
    const descriptor = chainId ? chainRegistry.get(chainId) : undefined;
    const nativeTicker = tickerForDescriptor(descriptor);
    const hostPrice = Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0 ? Number(currentPrice) : null;
    const tickFiatRate = useTickFiatRate({
        chainCoin: descriptor?.coin,
        tick,
        nativeTicker,
        fiatCurrency: cur.toUpperCase(),
        allowCoingeckoFallback,
        enabled: Boolean(chainId) && hostPrice == null,
    });
    const resolvedCurrentPrice = hostPrice != null
        ? hostPrice
        : Number.isFinite(Number(tickFiatRate?.rate)) && Number(tickFiatRate.rate) > 0
            ? Number(tickFiatRate.rate)
            : null;
    const assetTicker = chainId ? alertAssetTicker(chainId, tick) : '';
    const tokenHasNoPrice = Boolean(tick) && resolvedCurrentPrice === null;

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const targetFiat = Number(targetStr);
    const targetValid = Number.isFinite(targetFiat) && targetFiat > 0;
    const valid = Boolean(chainId) && targetValid && !tokenHasNoPrice;
    const invalidTarget = targetStr !== '' && !targetValid;
    const priceError = chainId && invalidTarget ? t('settings.priceAlerts.priceMustBeAboveZero') : null;
    const noPriceMessage = tokenHasNoPrice
        ? t('components.priceAlertForm.noMarketPrice', { tick })
        : null;

    const alreadyMet = useMemo(() => {
        if (resolvedCurrentPrice == null || !valid) return false;
        return direction === 'above' ? resolvedCurrentPrice >= targetFiat : resolvedCurrentPrice <= targetFiat;
    }, [resolvedCurrentPrice, valid, direction, targetFiat]);

    // "Now $68,412, so 2.3% to go": how far the price must move to reach the target.
    const nowLine = (() => {
        if (!chainId) return t('settings.priceAlerts.pickAnAssetForPrice');
        if (resolvedCurrentPrice == null) return null;
        const now = formatCurrentPrice(resolvedCurrentPrice, cur);
        if (alreadyMet) {
            return t('settings.priceAlerts.alreadyMet', {
                asset: assetTicker,
                side: direction === 'above' ? t('components.priceAlertForm.above') : t('components.priceAlertForm.below'),
                target: formatCurrentPrice(targetFiat, cur),
            });
        }
        if (!valid) return t('settings.priceAlerts.nowPrice', { price: now });
        const pct = Math.abs(targetFiat - resolvedCurrentPrice) / resolvedCurrentPrice * 100;
        return t('settings.priceAlerts.nowPriceToGo', { price: now, percent: formatPercent(pct) });
    })();

    const updateInput = (setter, value, currentValue) => {
        if (value === currentValue) return;
        inputVersionRef.current += 1;
        setErr(null);
        setter(value);
    };

    const submit = async (event) => {
        event?.preventDefault?.();
        if (busy) return;
        if (!formErrors.validate({
            'price-alert-asset': !chainId
                ? t('send.selectAsset')
                : noPriceMessage,
            'price-alert-target': !targetStr.trim()
                ? t('settings.priceAlerts.priceMustBeAboveZero')
                : priceError,
        })) return;
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
                setErr(userFacingMessage(e, t('settings.priceAlerts.couldNotSave')));
            }
        } finally {
            if (mountedRef.current) setBusy(false);
        }
    };

    const closeTokenPicker = () => {
        setTokenPickerOpen(false);
        onTokenPickerScreenChange?.(null);
    };
    const tokenPickerScreen = (
        <TokenPicker
            purpose="send"
            walletId={walletId}
            kindFilter="all"
            // The coin can be alerted as well as a token, so the picker is the Choose Asset page.
            title={t('shell.markets.selectAsset')}
            onSelect={(selection) => {
                const selectedChainId = String(selection.chainId || chainId);
                const selectedDescriptor = chainRegistry.get(selectedChainId);
                const selectedTick = String(selection.tick || '').trim().toUpperCase();
                const selectedNativeTicker = String(tickerForDescriptor(selectedDescriptor) || '').toUpperCase();
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

    const directionOptions = [
        { value: 'above', label: t('settings.priceAlerts.risesAbove'), icon: <TrendUpIcon /> },
        { value: 'below', label: t('settings.priceAlerts.fallsBelow'), icon: <TrendDownIcon /> },
    ];
    const symbol = cur === 'usd' ? '$' : '';

    return (
        <FormFrame
            id="price-alert-form"
            label={editing ? t('settings.priceAlerts.editTitle') : t('settings.priceAlerts.addTitle')}
            onSubmit={submit}
            errors={formErrors}
            lead={err ? (
                <StatusMessage variant="error">{err}</StatusMessage>
            ) : (
                <StatusMessage variant="info">{t('settings.priceAlerts.firesOnce')}</StatusMessage>
            )}
            action={(
                <FormAction
                    icon={editing ? <Icon.SaveIcon /> : <Icon.BellIcon />}
                    loading={busy}
                >
                    {editing ? t('settings.priceAlerts.saveAlert') : t('components.priceAlertForm.savePriceAlert')}
                </FormAction>
            )}
        >
            <>
                <TokenField
                    id="price-alert-asset"
                    label={t('send.asset')}
                    help={t('settings.priceAlerts.assetHelp')}
                    value={chainId ? { chainId, tick: assetTicker } : null}
                    placeholder={t('send.selectAsset')}
                    onOpenPicker={() => {
                        setTokenPickerOpen(true);
                        onTokenPickerScreenChange?.(tokenPickerScreen);
                    }}
                    disabled={!walletId}
                    error={noPriceMessage || undefined}
                />
                <IconSelect
                    label={t('settings.priceAlerts.whenThePrice')}
                    help={t('settings.priceAlerts.whenThePriceHelp')}
                    value={direction}
                    onChange={(next) => updateInput(setDirection, next, direction)}
                    options={directionOptions}
                />
                <div>
                    <Input
                        id="price-alert-target"
                        type="text"
                        inputMode="decimal"
                        enterKeyHint="go"
                        label={t('components.priceAlertForm.targetPrice')}
                        help={t('settings.priceAlerts.targetHelp')}
                        placeholder={symbol ? `${symbol} ${t('components.placeOrderPanel.price')}` : t('components.placeOrderPanel.price')}
                        value={targetStr}
                        error={priceError || undefined}
                        aria-describedby={nowLine ? noteId : undefined}
                        fieldAction={<span aria-hidden="true">{cur.toUpperCase()}</span>}
                        onChange={(e) => updateInput(
                            setTargetStr,
                            normalizeDecimalEntry(e.target.value, targetStr),
                            targetStr,
                        )}
                    />
                    {nowLine ? <p id={noteId} data-price-now="" style={NOTE_STYLE}>{nowLine}</p> : null}
                </div>
            </>
        </FormFrame>
    );
}

const NOTE_STYLE = {
    margin: 'var(--xc-space-1) 0 0',
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-xs)',
};

function normalizeDecimalEntry(value, previous) {
    const stripped = String(value).replace(/,/g, '');
    return stripped === '' || /^\d*\.?\d*$/.test(stripped) ? stripped : previous;
}

/** Group a displayed price without dropping decimal precision. */
export function formatCurrentPrice(value, currency) {
    const code = String(currency || 'usd').toUpperCase();
    const amount = formatWithThousands(String(value));
    return code === 'USD' ? `$${amount}` : `${amount} ${code}`;
}

/** 2.34 → "2.3"; a move under a tenth of a percent reads "under 0.1". */
export function formatPercent(pct) {
    if (!Number.isFinite(pct)) return '0';
    if (pct > 0 && pct < 0.1) return t('settings.priceAlerts.underTenth');
    return pct >= 100 ? String(Math.round(pct)) : (Math.round(pct * 10) / 10).toString();
}
