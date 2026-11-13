// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Network fee section of the Wallet Form Standard, last before
// the status slot and the action. It wraps the existing FeeSelector (and the
// existing FeesCard on forms with a protocol fee); it never forks them.

import { selectedNetworkFee } from '../../../flows/feesCard.js';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/send.js';
import '../../../i18n/locales/en/ui.js';
import { FeeSelector } from '../../../ui/FeeSelector.jsx';
import { ZapIcon } from '../../../ui/icons/index.jsx';
import { FeesCard } from '../FeesCard.jsx';
import feesStyles from '../FeesCard.module.css';
import { FormSection } from './FormSection.jsx';
import { joinSummary } from './summaryText.js';

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

/**
 * The closed summary of a fee pick: "Normal, ~30 min, 0.0000042" plus the
 * unit separately, so the section can drop the unit before it truncates.
 *
 * @returns {{ text: string, unit: string | undefined }}
 */
export function feeSummaryParts({ tiers, value, customEstimate = null, etaMinutes, coinTicker, protocolSummary, fixedFee }) {
    const mode = value?.mode || 'normal';
    const eta = Number.isFinite(etaMinutes)
        ? etaMinutes
        : (mode === 'custom' ? customEstimate?.etaMinutes : tiers?.[mode]?.etaMinutes);
    // A fixed fee (no speed pick) is the normal-rate figure itself.
    const fee = fixedFee != null && fixedFee !== ''
        ? fixedFee
        : selectedNetworkFee({ tiers, value, customEstimate });
    const feeText = fee ? trimDecimal(fee) : null;
    const etaText = Number.isFinite(eta) ? `~${eta} ${t('ui.feeSelector.min')}` : null;
    // A protocol fee joins the same row; the coin unit then sits mid-text and
    // stays, so only a plain network fee drops its unit.
    if (protocolSummary) {
        return {
            text: joinSummary(speedLabel(mode), etaText, feeText && coinTicker ? `${feeText} ${coinTicker}` : feeText, protocolSummary),
            unit: undefined,
        };
    }
    return {
        text: joinSummary(speedLabel(mode), etaText, feeText),
        unit: feeText && coinTicker ? coinTicker : undefined,
    };
}

/**
 * One "Network fee" section, closed by default, summarising the pick as
 * "Normal, ~30 min, 0.0000042 BTC". Open, it shows the existing Slow /
 * Normal / Fast / Custom selector, then either:
 *   - `totals`: rows such as Amount, Network fee, Total (plain forms), or
 *   - `fees`: the props of the existing FeesCard (quote, pending,
 *     nativeFeeProps, nativeSwitch), for forms with a protocol fee; its
 *     network, protocol and total rows replace `totals`.
 * `children` render between the selector and the totals: the slot for any
 * other protocol fee lines a form needs.
 *
 * A fee error (`error`) opens the section by itself.
 *
 * Fixed-fee mode (`fixedFee`): for a form whose lane takes no fee pick (the
 * list forms, Open a Market), the section shows the network fee figure with
 * no speed picker. Its summary reads "Normal, ~30 min, 0.0000042 BTC"; open,
 * it shows a Network fee row (or `totals`), or the FeesCard without a
 * selector when `fees` is passed; `children` still render (a "set at review"
 * note). `tiers`, `value` and `onChange` are not needed in this mode.
 *
 * @param {object} props
 * @param {string} [props.id]                     default 'fee'
 * @param {string} [props.title]                  default "Network fee"
 * @param {string} props.chainId
 * @param {object | null} [props.tiers]           from estimateNativeSendFeeTiers; null while they load
 * @param {{ mode: string, customRate?: number }} [props.value]
 * @param {(next: object) => void} [props.onChange]
 * @param {string | null} [props.fixedFee]        the network fee in coin units, shown without a speed picker
 * @param {object | null} [props.customEstimate]
 * @param {number} [props.etaMinutes]             overrides the tier's ETA in the summary
 * @param {string} [props.coinTicker]             BTC / LTC / DOGE
 * @param {string | null} [props.error]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.allowCustom]
 * @param {string} [props.protocolSummary]        appended to the summary ("0.5 XCHAIN protocol fee")
 * @param {Array<{ key?: string, label: import('react').ReactNode, value: import('react').ReactNode, fiat?: import('react').ReactNode, strong?: boolean }>} [props.totals]
 * @param {object} [props.fees]                   FeesCard props for a protocol-fee form
 * @param {import('react').ReactNode} [props.children]
 * @param {boolean} [props.open]
 * @param {(open: boolean) => void} [props.onOpenChange]
 * @param {boolean} [props.defaultOpen]
 * @param {unknown} [props.revealKey]
 */
export function FeeSection({
    id = 'fee',
    title = t('send.networkFee'),
    chainId,
    tiers,
    value,
    onChange,
    customEstimate = null,
    etaMinutes,
    coinTicker,
    error = null,
    disabled = false,
    allowCustom,
    protocolSummary,
    totals,
    fees,
    fixedFee,
    children,
    open,
    onOpenChange,
    defaultOpen = false,
    revealKey,
}) {
    const fixed = fixedFee !== undefined;
    const pick = fixed ? { mode: 'normal' } : value;
    const summary = feeSummaryParts({
        tiers: fixed ? null : tiers, value: pick, customEstimate, etaMinutes, coinTicker, protocolSummary, fixedFee,
    });
    // A fixed fee shows one Network fee row unless the host passes
    // its own totals or a FeesCard.
    const fixedText = fixed && fixedFee ? `${fixedFee} ${coinTicker || ''}`.trim() : null;
    const fixedTotals = fixed && totals === undefined && !fees && fixedText
        ? [{ key: 'network', label: title, value: fixedText }]
        : null;
    // The tiers seed after the chain is known, so the selector waits for them
    // rather than opening on Custom for one render. A fixed fee has none.
    const selector = !fixed && tiers ? (
        <FeeSelector
            chainId={chainId}
            coinTicker={coinTicker}
            tiers={tiers}
            value={value}
            onChange={onChange}
            customEstimate={value?.mode === 'custom' ? customEstimate : null}
            error={error}
            disabled={disabled}
            {...(allowCustom === undefined ? {} : { allowCustom })}
        />
    ) : null;
    const rows = Array.isArray(totals) ? totals.filter(Boolean) : (fixedTotals || []);
    return (
        <FormSection
            id={id}
            title={title}
            icon={ZapIcon}
            summary={summary.text || null}
            summaryUnit={summary.unit}
            open={open}
            onOpenChange={onOpenChange}
            defaultOpen={defaultOpen}
            revealKey={error ? (revealKey || `fee-error:${error}`) : revealKey}
        >
            {fees ? (
                <FeesCard
                    chainId={chainId}
                    coinTicker={coinTicker}
                    feeSelector={selector}
                    tiers={tiers}
                    value={pick}
                    customEstimate={customEstimate}
                    {...fees}
                />
            ) : selector}
            {children}
            {!fees && rows.length > 0 ? (
                // FeesCard's root keeps its line card framed inside a section
                // card and sits 8px under the selector, as the Fees card does.
                <div className={feesStyles.root} data-fee-totals="">
                <div className={feesStyles.card}>
                    {rows.map((row, i) => (
                        <div
                            key={row.key || i}
                            className={`${feesStyles.row} ${row.strong ? feesStyles.total : ''}`.trim()}
                            data-fees-row={row.key || undefined}
                        >
                            <div className={feesStyles.rowMain}>
                                <span className={feesStyles.label}>{row.label}</span>
                                <span className={feesStyles.figures}>
                                    <span>{row.value}</span>
                                    {row.fiat ? <span className={feesStyles.fiat}>{row.fiat}</span> : null}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
                </div>
            ) : null}
        </FormSection>
    );
}
