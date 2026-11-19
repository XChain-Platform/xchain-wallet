// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one Fees section of the Wallet Form Standard, last before the status
// slot and the action, on every form that pays a fee. Closed it reads
// "Normal · ~$0.45"; open it shows the speed slider, the Network fee line
// and, on an action with a protocol fee, the Protocol fee line and its
// pay-in-coin switch. The Total lives on the confirm screen, never here.

import { useContext } from 'react';
import { formatCoinBaseUnits, formatFeesTotal, selectedNetworkFee } from '../../../flows/feesCard.js';
import { normalizeProtocolFee } from '../../../flows/protocolFeeRow.js';
import { formatWithThousands } from '../../utils/amountFormat.js';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/execute.js';
import '../../../i18n/locales/en/flows.js';
import '../../../i18n/locales/en/send.js';
import '../../../i18n/locales/en/ui.js';
import { defaultRegistry } from '../../../registry/index.js';
import { protocolCoinTickerFor } from '../../../registry/nativeFee.js';
import { Spinner } from '../../../ui/Button.jsx';
import { FeeSelector } from '../../../ui/FeeSelector.jsx';
import selectorStyles from '../../../ui/FeeSelector.module.css';
import { InfoTip } from '../../../ui/InfoTip.jsx';
import { Switch } from '../../../ui/Switch.jsx';
import { ZapIcon } from '../../../ui/icons/index.jsx';
import { usePickedFieldError } from '../../../ui/formErrors.js';
import { MessagingContext } from '../../MessagingContext.js';
import { useFeeFiat } from '../../hooks/useFeeFiat.js';
import { useSettings } from '../../hooks/useSettings.js';
import styles from './FeeSection.module.css';
import { AdvancedSlot } from './AdvancedSection.jsx';
import { FormSection } from './FormSection.jsx';

const chainRegistry = defaultRegistry();
const SUMMARY_SEPARATOR = ' · ';

function speedLabel(mode) {
    return {
        low: t('ui.feeSelector.slow'),
        normal: t('ui.feeSelector.normal'),
        fast: t('ui.feeSelector.fast'),
        custom: t('ui.feeSelector.custom'),
    }[mode] || '';
}

function trimDecimal(value) {
    const text = String(value);
    return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

// A fee amount as the section shows it: zero tail trimmed, thousands grouped
// ("12,500 XCHAIN"), every significant place kept.
function shownDecimal(value) {
    const trimmed = trimDecimal(value);
    return formatWithThousands(trimmed) || trimmed;
}

function hasValue(text) {
    return typeof text === 'string' && /[1-9]/.test(text);
}

/**
 * What the section knows about the action's protocol fee, read from the
 * `fees` prop: the quote, whether it is still loading, and the pay-in-coin
 * switch. The switch props come as `nativeFeeProps`, or as the props of a
 * NativeFeeToggle element passed as `children`. Null when the action has no
 * protocol fee.
 *
 * @param {object | undefined} fees
 * @param {string} [coinTicker]
 */
export function protocolFeeState(fees, coinTicker) {
    if (!fees) return null;
    const toggleProps = fees.children?.props || null;
    const quote = fees.quote ?? toggleProps?.fee ?? null;
    const nativeFeeProps = fees.nativeFeeProps ?? toggleProps;
    const showSwitch = fees.nativeSwitch ?? Boolean(nativeFeeProps);
    const ticker = coinTicker || nativeFeeProps?.coinTicker || '';
    // A form that knows the action is free before any quote (a trade inside
    // the expiration free period, operator 2026-11-13) says Free at once; a
    // quote that lands still has the last word.
    const knownFree = fees.free === true && (fees.pending === true || quote === null);
    const normalized = knownFree ? { known: true, free: true, amount: '0' } : normalizeProtocolFee(quote);
    const mandatory = nativeFeeProps?.mandatory === true;
    const checked = mandatory || nativeFeeProps?.checked === true;
    const payInNative = showSwitch && checked;
    const nativeAmount = normalized.free ? '0' : formatCoinBaseUnits(quote?.requiredFeeSats);
    const xchain = normalized.free ? '0' : normalized.amount;
    const pending = fees.pending === true && !knownFree;
    // Still waiting for the form's inputs: nothing is loading, so the line
    // says the fee is priced at review rather than calculating for good.
    const waiting = pending && fees.waiting === true;
    // Paid in coin with no oracle price to convert at, the fee itself is
    // still known in XCHAIN: the line shows it and only the coin amount
    // under the switch waits for review.
    const nativeUnpriced = !pending && normalized.known && payInNative
        && nativeAmount === null && xchain !== null;
    const unavailable = !pending && (
        !normalized.known
        || (xchain === null && (!payInNative || nativeAmount === null))
    );
    return {
        quote,
        free: normalized.free,
        nativeFeeProps,
        showSwitch: showSwitch && Boolean(ticker),
        ticker,
        mandatory,
        checked,
        payInNative,
        nativeAmount,
        xchain,
        pending,
        waiting,
        unavailable,
        nativeUnpriced,
        unverified: nativeFeeProps?.unverified === true,
    };
}

/**
 * The closed summary: the speed, then the whole fee in fiat ("Normal ·
 * ~$0.45": the network fee plus any protocol fee). With no price (testnet,
 * an unpriced token) it falls back to coin amounts ("Normal · 0.0000042 BTC
 * + 10 XCHAIN"). While the protocol fee loads, `loading` is set and the text
 * is the speed alone, for a spinner to follow.
 *
 * @returns {{ text: string, unit: string | undefined, loading: boolean }}
 */
export function feeSummaryParts({
    tiers, value, customEstimate = null, fixedFee, coinTicker = '', protocol = null, fiat = null,
}) {
    const fixed = fixedFee !== undefined;
    const mode = fixed ? 'normal' : (value?.mode || 'normal');
    const speed = speedLabel(mode);
    const networkFee = fixed
        ? selectedNetworkFee({ tiers: { normal: { coinAmount: fixedFee } }, value: { mode: 'normal' } })
        : selectedNetworkFee({ tiers, value, customEstimate });
    const ticker = String(coinTicker || protocol?.ticker || '').trim();
    // The closed summary never spins (operator 2026-11-13): the protocol fee
    // is "pending" until the form has its inputs, which can be for good on an
    // empty form, so the summary shows the speed and network fee it has and
    // adds the protocol fee once its quote lands. The open section still
    // says the protocol fee is being calculated.
    if (protocol?.pending) protocol = null;
    if (!networkFee) return { text: speed, unit: undefined, loading: false };

    const networkCoin = shownDecimal(networkFee);
    const join = (rest) => `${speed}${SUMMARY_SEPARATOR}${rest}`;
    if (protocol?.unavailable) {
        const network = fiat?.formatNativeFee?.(networkFee) || `${networkCoin} ${ticker}`.trim();
        return { text: join(`${network} + ${t('flows.feesCard.protocolAtReview')}`), unit: undefined, loading: false };
    }

    const nativeProtocol = protocol?.payInNative && hasValue(protocol.nativeAmount) ? protocol.nativeAmount : null;
    // A coin payment with no price to convert at still costs its XCHAIN
    // figure, so the summary counts that rather than leave the fee out.
    const xchainProtocol = protocol && (!protocol.payInNative || protocol.nativeUnpriced)
        && hasValue(protocol.xchain) ? protocol.xchain : null;
    const fiatTotal = fiat?.formatFeeTotal?.({
        native: [networkFee, ...(nativeProtocol ? [nativeProtocol] : [])],
        protocol: xchainProtocol,
    });
    if (fiatTotal) return { text: join(fiatTotal), unit: undefined, loading: false };

    // Coin amounts: a plain network fee keeps its unit apart, so the row can
    // drop it before it truncates; a protocol part keeps the text whole.
    if (!nativeProtocol && !xchainProtocol) {
        return { text: join(networkCoin), unit: ticker || undefined, loading: false };
    }
    const coins = formatFeesTotal({
        coinTicker: ticker,
        networkFee,
        protocolXchain: protocol?.xchain ?? '0',
        protocolNativeSats: protocol?.free ? 0 : protocol?.quote?.requiredFeeSats,
        payInNative: Boolean(protocol?.payInNative && !protocol?.nativeUnpriced),
    });
    return {
        text: join(coins || `${networkCoin} ${ticker} + ${shownDecimal(xchainProtocol || '0')} XCHAIN`.trim()),
        unit: undefined,
        loading: false,
    };
}

/**
 * The one Fees section, closed by default. Open, in this order and nothing
 * nested: the Slow / Normal / Fast / Custom slider with the time under each
 * stop; the Network fee line with its help tip, amount and fiat; then, only
 * when the action has a protocol fee (`fees`), a thin rule, the Protocol fee
 * line with its help tip, amount and fiat, and the "Pay protocol fee in BTC"
 * switch (the converted amount under its label while on; on and locked where
 * the native output is the protocol fee, `mandatory`). `children` follow:
 * the slot for a note such as "set at review" or a native-fee warning.
 *
 * A fee error (`error`) opens the section by itself.
 *
 * Fixed-fee mode (`fixedFee`): for a lane that takes no speed pick, the slider
 * is left out and the Network fee line
 * shows that figure; the summary reads "Normal · ~$0.39". `tiers`, `value`
 * and `onChange` are not needed in this mode.
 *
 * @param {object} props
 * @param {string} [props.id]                     default 'fee'
 * @param {string} props.chainId
 * @param {object | null} [props.tiers]           from estimateNativeSendFeeTiers; null while they load
 * @param {{ mode: string, customRate?: number }} [props.value]
 * @param {(next: object) => void} [props.onChange]
 * @param {string | number | null} [props.fixedFee] the network fee in coin units, shown without a speed picker
 * @param {object | null} [props.customEstimate]
 * @param {string} [props.coinTicker]             BTC / LTC / DOGE
 * @param {string | null} [props.error]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.allowCustom]
 * @param {{ quote?: object | null, pending?: boolean, nativeFeeProps?: object | null,
 *   nativeSwitch?: boolean, children?: import('react').ReactElement, fiat?: object,
 *   free?: boolean, waiting?: boolean }} [props.fees]
 *   `free` says Free before any quote (the form knows the action costs
 *   nothing); `waiting` marks a pending quote still waiting for inputs
 *   the action's protocol fee: its quote, whether it is loading, and the
 *   pay-in-coin switch (`nativeFeeProps`: checked, onChange, mandatory,
 *   unverified, disabled; or a NativeFeeToggle element as `children`);
 *   `nativeSwitch: false` hides the switch; `fiat` passes fee prices the
 *   form already resolved (useFeeFiat's formatters)
 * @param {import('react').ReactNode} [props.children]
 * @param {boolean} [props.open]
 * @param {(open: boolean) => void} [props.onOpenChange]
 * @param {boolean} [props.defaultOpen]
 * @param {unknown} [props.revealKey]
 * @param {string} [props.formErrorKey]  the entry of the form's error map (useFormErrors) about the fee, e.g.
 *   'form:fee': it shows as the fee's refusal (`error` wins), reopens the section on every press, and leaves
 *   the map when the speed, the custom rate or the pay-in-coin switch changes
 * @param {boolean | { rbf?: boolean, coins?: boolean, change?: boolean, rbfDefault?: boolean | null,
 *   coinsNote?: import('react').ReactNode }} [props.advanced]
 *   the Advanced section drawn directly above this one (inside a FormFrame):
 *   `false` leaves it out, an object turns off the options this action
 *   cannot honour (`{ coins: false, change: false }` for fixed inputs or
 *   outputs). Every option is on by default.
 */
export function FeeSection(props) {
    // Settings and prices come through messaging; a section rendered outside
    // the wallet shell (the style guide, an isolated test) shows no fiat.
    // Messaging never comes or goes under a mounted form, so the section
    // never remounts and keeps its open state.
    const messaging = useContext(MessagingContext);
    const { advanced, ...feeProps } = props;
    // Every form with Speed and Fees gets Advanced directly above it, so no
    // form places that section itself.
    return (
        <>
            <AdvancedSlot chainId={props.chainId} advanced={advanced} disabled={props.disabled} />
            {messaging
                ? <FeeSectionWithFiat {...feeProps} />
                : <FeeSectionContent {...feeProps} fiat={null} />}
        </>
    );
}

function FeeSectionWithFiat(props) {
    const { settings } = useSettings();
    const descriptor = props.chainId ? chainRegistry.get(props.chainId) : null;
    // Prices are read only once there is a fee to price: a form still
    // waiting on its estimate (or a demo session that has none) reads none.
    const fiat = useFeeFiat({
        chainId: props.chainId,
        chainCoin: descriptor?.coin,
        nativeTicker: protocolCoinTickerFor(descriptor),
        settings,
        active: Boolean(props.tiers || props.fixedFee || props.fees?.quote),
    });
    return <FeeSectionContent {...props} fiat={fiat} />;
}

function FeeSectionContent({
    id = 'fee',
    chainId,
    tiers,
    value,
    onChange,
    customEstimate = null,
    coinTicker,
    error: errorProp = null,
    disabled = false,
    allowCustom,
    fees,
    fixedFee,
    fiat: ownFiat,
    children,
    open,
    onOpenChange,
    defaultOpen = false,
    revealKey: revealKeyProp,
    formErrorKey,
}) {
    const fixed = fixedFee !== undefined;
    // A form that already resolved its fee prices passes them as `fees.fiat`.
    const fiat = fees?.fiat ?? ownFiat;
    const protocol = protocolFeeState(fees, coinTicker);
    // A new speed, custom rate or pay-in-coin choice reaches this section as
    // a new value, so the fee entry leaves the form's map when one moves.
    const feeEntry = usePickedFieldError(
        formErrorKey,
        `${value?.mode || ''}|${value?.customRate ?? ''}|${fixedFee ?? ''}|${protocol?.checked ? 1 : 0}`,
    );
    const error = errorProp || feeEntry.error || null;
    const revealKey = !errorProp && feeEntry.error ? `fee-entry:${feeEntry.errorKey}` : revealKeyProp;
    const ticker = String(coinTicker || protocol?.ticker || '').trim();
    const summary = feeSummaryParts({
        tiers: fixed ? null : tiers, value, customEstimate, fixedFee, coinTicker: ticker, protocol, fiat,
    });
    const summaryNode = summary.loading ? (
        <>
            {`${summary.text}${SUMMARY_SEPARATOR}`}
            <span className={styles.summaryLoading} data-fee-summary-loading="">
                <Spinner size="sm" />
                <span className={styles.visuallyHidden}>{t('flows.feesCard.protocolFeeLoading')}</span>
            </span>
        </>
    ) : (summary.text || null);

    const networkLabel = (
        <>
            {t('send.networkFee')}
            <InfoTip
                aria={t('flows.feesCard.networkFeeHelpLabel')}
                label={t('flows.feesCard.networkFeeHelp')}
            />
        </>
    );

    // The tiers seed after the chain is known, so the selector waits for them
    // rather than opening on Custom for one render. A fixed fee has none.
    const selector = !fixed && tiers ? (
        <FeeSelector
            chainId={chainId}
            coinTicker={ticker}
            tiers={tiers}
            value={value}
            onChange={onChange}
            customEstimate={value?.mode === 'custom' ? customEstimate : null}
            error={error}
            disabled={disabled}
            fiat={fiat}
            lineLabel={networkLabel}
            {...(allowCustom === undefined ? {} : { allowCustom })}
        />
    ) : null;

    // Without a slider (a fixed fee, or tiers still loading) the Network fee
    // line stands alone.
    const networkFee = fixed
        ? selectedNetworkFee({ tiers: { normal: { coinAmount: fixedFee } }, value: { mode: 'normal' } })
        : selectedNetworkFee({ tiers, value, customEstimate });
    const networkLine = selector ? null : (
        <FeeLine
            kind="network"
            label={networkLabel}
            amount={networkFee ? shownDecimal(networkFee) : null}
            unit={ticker}
            fiat={networkFee ? fiat?.formatNativeFee?.(networkFee) : null}
            placeholder={t('flows.feesCard.calculating')}
        />
    );

    return (
        <FormSection
            id={id}
            title={t('flows.feesCard.title')}
            icon={ZapIcon}
            summary={summaryNode}
            summaryUnit={summary.loading ? undefined : summary.unit}
            open={open}
            onOpenChange={onOpenChange}
            defaultOpen={defaultOpen}
            revealKey={error ? (revealKey || `fee-error:${error}`) : revealKey}
        >
            {selector}
            {networkLine}
            {protocol ? <ProtocolFee protocol={protocol} fiat={fiat} /> : null}
            {children}
        </FormSection>
    );
}

function ProtocolFee({ protocol, fiat }) {
    const {
        xchain, nativeAmount, ticker, payInNative, pending, unavailable, nativeFeeProps,
    } = protocol;
    const unresolved = pending || unavailable || protocol.free;
    const placeholder = protocol.free
        ? t('flows.feesCard.free')
        : (unavailable || protocol.waiting ? t('flows.feesCard.pricedAtReview') : t('flows.feesCard.calculating'));
    // The line names the fee in XCHAIN; paid in coin, the converted amount
    // sits under the switch label instead.
    const inXchain = xchain !== null;
    const rawAmount = unresolved ? null : (inXchain ? xchain : nativeAmount);
    const amount = rawAmount == null ? null : shownDecimal(rawAmount);
    const unit = inXchain ? 'XCHAIN' : ticker;
    const amountFiat = unresolved ? null : (inXchain
        ? fiat?.formatProtocolFee?.(xchain)
        : fiat?.formatNativeFee?.(nativeAmount));
    // Data state, not a toggle: the safety text shows only for an unverified fee.
    const showUnverifiedHint = Boolean(protocol.unverified && payInNative);
    // With no oracle price the coin amount is the one part still unknown, so
    // only it says it is priced at review.
    const converted = payInNative && !unresolved && nativeAmount !== null
        ? [`${shownDecimal(nativeAmount)} ${ticker}`.trim(), fiat?.formatNativeFee?.(nativeAmount)].filter(Boolean).join(' ')
        : (protocol.nativeUnpriced ? t('flows.feesCard.pricedAtReview') : null);
    return (
        <>
            <hr className={styles.divider} />
            <FeeLine
                kind="protocol"
                label={t('execute.protocolFee')}
                amount={amount}
                unit={unit}
                fiat={amountFiat}
                placeholder={placeholder}
            />
            {showUnverifiedHint ? (
                <p className={styles.hint} data-fees-unverified-hint="">
                    {t('flows.protocolFee.unverifiedNotice')}
                </p>
            ) : null}
            {protocol.showSwitch ? (
                <Switch
                    className={styles.protocolSwitch}
                    label={t('flows.protocolFee.toggleLabel', { ticker })}
                    help={t('flows.protocolFee.toggleHelp', { ticker })}
                    description={converted || undefined}
                    checked={protocol.checked}
                    disabled={protocol.mandatory || nativeFeeProps?.disabled === true}
                    onChange={(event) => nativeFeeProps?.onChange?.(event.target.checked)}
                    data-fees-switch=""
                />
            ) : null}
        </>
    );
}

function FeeLine({ kind, label, amount, unit, fiat, placeholder }) {
    return (
        <div className={`${selectorStyles.sliderReadout} ${selectorStyles.feeLine}`} data-fees-row={kind}>
            <span className={selectorStyles.feeLineLabel}>{label}</span>
            <span className={selectorStyles.sliderReadoutPrimary}>
                {amount !== null && amount !== undefined ? (
                    <>
                        {amount}
                        {unit ? <span className={selectorStyles.sliderReadoutCoin}> {unit}</span> : null}
                        {fiat ? <span className={selectorStyles.sliderReadoutFiat}>{fiat}</span> : null}
                    </>
                ) : placeholder}
            </span>
        </div>
    );
}
