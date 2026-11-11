// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { cloneElement, isValidElement } from 'react';
import { formatCoinBaseUnits, formatFeesTotal, selectedNetworkFee } from '../../flows/feesCard.js';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/execute.js';
import '../../i18n/locales/en/flows.js';
import '../../i18n/locales/en/send.js';
import { defaultRegistry } from '../../registry/index.js';
import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
import { InfoTip } from '../../ui/InfoTip.jsx';
import { Switch } from '../../ui/Switch.jsx';
import { useFeeFiat } from '../hooks/useFeeFiat.js';
import { useSettings } from '../hooks/useSettings.js';
import styles from './FeesCard.module.css';

const chainRegistry = defaultRegistry();

export function FeesCard(props) {
    if (props.fiat || !props.chainId) return <FeesCardContent {...props} />;
    return <FeesCardWithFiat {...props} />;
}

function FeesCardWithFiat({ chainId, ...props }) {
    const { settings } = useSettings();
    const descriptor = chainRegistry.get(chainId);
    const fiat = useFeeFiat({
        chainId,
        chainCoin: descriptor?.coin,
        nativeTicker: protocolCoinTickerFor(descriptor),
        settings,
    });
    return <FeesCardContent {...props} chainId={chainId} fiat={fiat} />;
}

function FeesCardContent({
    feeSelector,
    chainId,
    children = null,
    tiers: tiersProp,
    value: valueProp,
    customEstimate: customEstimateProp,
    coinTicker,
    quote = null,
    pending = false,
    nativeFeeProps = null,
    nativeSwitch,
    fiat = null,
}) {
    const selectorProps = feeSelector?.props || {};
    const toggleProps = children?.props || {};
    const tiers = tiersProp ?? selectorProps.tiers;
    const value = valueProp ?? selectorProps.value;
    const customEstimate = customEstimateProp ?? selectorProps.customEstimate ?? null;
    const ticker = coinTicker || selectorProps.coinTicker || toggleProps.coinTicker || '';
    const effectiveQuote = quote ?? toggleProps.fee ?? null;
    const effectiveNativeFeeProps = nativeFeeProps ?? toggleProps;
    const showNativeSwitch = nativeSwitch ?? Boolean(children || nativeFeeProps);
    const networkFee = selectedNetworkFee({ tiers, value, customEstimate });
    const normalized = normalizeProtocolFee(effectiveQuote);
    const mandatory = effectiveNativeFeeProps?.mandatory === true;
    const checked = mandatory || effectiveNativeFeeProps?.checked === true;
    const payInNative = showNativeSwitch && checked;
    const protocolNative = formatCoinBaseUnits(effectiveQuote?.requiredFeeSats);
    const protocolXchain = normalized.free ? '0' : normalized.amount;
    const quoteUnavailable = !pending && (
        !normalized.known
        || (payInNative && !normalized.free && protocolNative === null)
    );
    const calculating = !quoteUnavailable && pending;
    const unresolved = quoteUnavailable || calculating;
    const networkFiat = networkFee ? fiat?.formatNativeFee?.(networkFee) : null;
    const protocolFiat = unresolved
        ? null
        : payInNative
            ? (protocolNative ? fiat?.formatNativeFee?.(protocolNative) : null)
            : fiat?.formatProtocolFee?.(protocolXchain);
    const totalFiat = unresolved || !networkFee
        ? null
        : fiat?.formatFeeTotal?.({
            native: [networkFee, ...(payInNative && protocolNative ? [protocolNative] : [])],
            protocol: payInNative ? null : protocolXchain,
        });
    const total = unresolved ? null : formatFeesTotal({
        coinTicker: ticker,
        networkFee,
        protocolXchain,
        protocolNativeSats: normalized.free ? 0 : effectiveQuote?.requiredFeeSats,
        payInNative,
        fiatText: totalFiat,
    });
    const pendingText = t('flows.feesCard.calculating');
    const reviewText = t('flows.feesCard.pricedAtReview');
    const unresolvedText = quoteUnavailable ? reviewText : pendingText;
    const protocolHelp = effectiveNativeFeeProps?.unverified && payInNative
        ? `${t('flows.feesCard.protocolFeeHelp')} ${t('flows.protocolFee.unverifiedNotice')}`
        : t('flows.feesCard.protocolFeeHelp');
    const selectorWithFiat = isValidElement(feeSelector) && typeof feeSelector.type !== 'string'
        // The card shares its price lookup; a card without a chain keeps the selector's own.
        ? cloneElement(feeSelector, {
            chainId: chainId ?? feeSelector.props.chainId,
            fiat: fiat ?? feeSelector.props.fiat,
        })
        : feeSelector;

    return (
        <div className={styles.root} data-fees-card="">
            <div className={styles.selector}>{selectorWithFiat}</div>
            <div className={styles.card}>
                <FeeRow
                    kind="network"
                    label={t('send.networkFee')}
                    amount={networkFee ? `${trimDecimal(networkFee)} ${ticker}` : pendingText}
                    fiat={networkFiat}
                />
                <FeeRow
                    kind="protocol"
                    label={(
                        <span className={styles.labelWithHelp}>
                            {t('execute.protocolFee')}
                            <InfoTip
                                aria={t('flows.feesCard.protocolFeeHelpLabel')}
                                label={protocolHelp}
                                className={styles.protocolHelp}
                            />
                        </span>
                    )}
                    amount={unresolved
                        ? unresolvedText
                        : payInNative
                            ? `${normalized.free ? '0' : protocolNative} ${ticker}`
                            : `${protocolXchain ?? '0'} XCHAIN`}
                    fiat={protocolFiat}
                    control={showNativeSwitch ? (
                        <Switch
                            label={(
                                <span className={styles.visuallyHidden}>
                                    {t('flows.protocolFee.toggleLabel', { ticker })}
                                </span>
                            )}
                            className={styles.protocolSwitch}
                            checked={checked}
                            disabled={mandatory || effectiveNativeFeeProps?.disabled === true}
                            onChange={(event) => effectiveNativeFeeProps?.onChange?.(event.target.checked)}
                        />
                    ) : null}
                />
                <FeeRow
                    kind="total"
                    label={t('flows.feesCard.total')}
                    amount={total || unresolvedText}
                    strong
                />
            </div>
        </div>
    );
}

function FeeRow({ kind, label, amount, fiat = null, control = null, strong = false }) {
    return (
        <div className={`${styles.row} ${strong ? styles.total : ''}`} data-fees-row={kind}>
            <div className={`${styles.rowMain} ${control ? styles.rowMainWithControl : ''}`}>
                <span className={styles.label}>{label}</span>
                <span className={styles.figures}>
                    <span>{amount}</span>
                    {fiat ? <span className={styles.fiat}>{fiat}</span> : null}
                </span>
                {control ? <div className={styles.control}>{control}</div> : null}
            </div>
        </div>
    );
}

function trimDecimal(value) {
    const text = String(value);
    return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}
