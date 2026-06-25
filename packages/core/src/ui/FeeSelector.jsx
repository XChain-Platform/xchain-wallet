// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useId, useMemo } from 'react';
import styles from './FeeSelector.module.css';
import { InfoTip } from './InfoTip.jsx';

const TIER_SPEEDS = ['low', 'normal', 'fast'];
const SPEEDS_WITH_CUSTOM = [...TIER_SPEEDS, 'custom'];
const SPEED_LABELS = { low: 'Low', normal: 'Normal', fast: 'Fast', custom: 'Custom' };
// ETA-pill tint per priority: slower = warmer/riskier. Maps to the
// per-tone classes in the stylesheet (red / orange / green / white).
const ETA_TONE = { low: 'etaLow', normal: 'etaNormal', fast: 'etaFast', custom: 'etaCustom' };

/**
 * FeeSelector (§44.2): Low / Normal / Fast / Custom slider. Rendering
 * is driven by `tiers` from
 * `flows/feeEstimate.estimateNativeSendFeeTiers`; selection writes
 * back via `onChange`.
 *
 * The slider has four discrete stops (low / normal / fast / custom).
 * For the three tier stops the active rate + ETA + fee amount are
 * shown under the track. When the user lands on Custom, a sat/vB (or
 * equivalent) input appears in place of the readout so the rate can
 * be edited directly.
 *
 * The component is presentation-only: it does NOT compute fees
 * itself. Callers fetch tiers via `estimateNativeSendFeeTiers` and
 * pass them in; the selected tier (or custom rate) flows back via
 * `onChange({ mode, customRate? })`.
 *
 * Props
 *   - tiers      `{ low, normal, fast, unit }` from estimateNativeSendFeeTiers
 *   - value      `{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }`
 *   - onChange   `(next) => void` (same shape as `value`)
 *   - customEstimate  optional `FeeEstimate` for Custom mode. When provided,
 *                     its `coinAmount` + (via `formatFiat`) fiat figure render
 *                     in the same readout slot the tier modes use, so the live
 *                     fee stays visible as the user edits the rate.
 *   - disabled   `boolean`
 *   - coinTicker native coin symbol (BTC / LTC / DOGE) shown after the fee
 *               amount so it's unambiguous which coin the fee is paid in
 *
 * @typedef {object} FeeSelectorValue
 * @property {'low' | 'normal' | 'fast' | 'custom'} mode
 * @property {number} [customRate]   in chain's native unit (sat/vB or koinu/byte)
 */
export function FeeSelector({
    tiers,
    value,
    onChange,
    customEstimate = null,
    disabled = false,
    formatFiat,
    allowCustom = true,
    label = null,
    coinTicker = '',
}) {
    const customInputId = useId();
    const SPEEDS = allowCustom ? SPEEDS_WITH_CUSTOM : TIER_SPEEDS;
    const MAX_INDEX = SPEEDS.length - 1;

    // Header row: field label + contextual help on the left, the ETA
    // for the active tier on the right. Rendered above both the empty
    // state and the slider so the "what does this mean" affordance is
    // always next to the control (§37 / G122 InfoTip integration). ETA
    // sits up here rather than in the readout so the lower line is free
    // to show the fee amount + coin + fiat.
    const headerRow = (etaMinutes, speed) => (label || Number.isFinite(etaMinutes)) ? (
        <div className={styles.header}>
            {label ? (
                <span className={styles.label}>
                    {label}
                    <InfoTip
                        aria="Fee priority help"
                        label="Pick how fast this transaction confirms. Faster fees cost more; Custom sets an exact rate."
                    />
                </span>
            ) : <span />}
            {Number.isFinite(etaMinutes) ? (
                <span className={`${styles.headerEta} ${styles[ETA_TONE[speed]] || ''}`.trim()}>
                    ~{etaMinutes} min
                </span>
            ) : null}
        </div>
    ) : null;

    const tierList = useMemo(() => {
        if (!tiers) return [];
        return TIER_SPEEDS
            .map((speed) => ({ speed, estimate: tiers[speed] }))
            .filter((t) => t.estimate);
    }, [tiers]);

    if (!tiers || tierList.length === 0) {
        return (
            <div className={styles.wrap}>
                {headerRow()}
                <p className={styles.placeholder}>Fee estimate unavailable for this chain.</p>
            </div>
        );
    }

    const mode = value?.mode || 'normal';
    const isCustom = allowCustom && mode === 'custom';
    const sliderSpeed = SPEEDS.includes(mode) ? mode : 'normal';
    const sliderIndex = SPEEDS.indexOf(sliderSpeed);
    const activeEstimate = isCustom ? customEstimate : tiers[sliderSpeed];

    const seedCustomRate = () => (
        value?.customRate
        ?? tiers.normal?.rateValue
        ?? tiers.fast?.rateValue
        ?? tiers.low?.rateValue
        ?? 0
    );

    const pickSpeed = (speed) => {
        if (speed === 'custom') {
            onChange({ mode: 'custom', customRate: seedCustomRate() });
        } else {
            onChange({ mode: speed });
        }
    };

    const onSliderChange = (raw) => {
        const i = Math.max(0, Math.min(MAX_INDEX, Number(raw)));
        pickSpeed(SPEEDS[i] || 'normal');
    };

    const onCustomRateChange = (raw) => {
        const n = parseFloat(raw);
        onChange({ mode: 'custom', customRate: Number.isFinite(n) ? n : 0 });
    };

    return (
        <div className={styles.wrap}>
            {headerRow(activeEstimate?.etaMinutes, isCustom ? 'custom' : sliderSpeed)}
            <div className={styles.sliderBlock} data-active-speed={sliderSpeed}>
                <input
                    type="range"
                    min={0}
                    max={MAX_INDEX}
                    step={1}
                    value={sliderIndex}
                    onChange={(e) => onSliderChange(e.target.value)}
                    disabled={disabled}
                    aria-label="Network fee"
                    aria-valuetext={isCustom
                        ? `Custom: ${Number.isFinite(value?.customRate) ? value.customRate : ''} ${tiers.unit}`.trim()
                        : `${SPEED_LABELS[sliderSpeed]}: ${activeEstimate?.coinAmount ?? ''}${activeEstimate?.etaMinutes ? ` · ~${activeEstimate.etaMinutes} min` : ''}`}
                    className={styles.slider}
                />
                <div className={styles.sliderTicks} aria-hidden="true">
                    {SPEEDS.map((s, i) => (
                        <button
                            key={s}
                            type="button"
                            className={`${styles.sliderTick} ${sliderSpeed === s ? styles.sliderTickActive : ''}`.trim()}
                            style={{ left: `calc(${MAX_INDEX ? i / MAX_INDEX : 0} * (100% - var(--fee-thumb)) + var(--fee-thumb) / 2)` }}
                            onClick={() => pickSpeed(s)}
                            disabled={disabled}
                            tabIndex={-1}
                            aria-label={SPEED_LABELS[s]}
                        >
                            {SPEED_LABELS[s]}
                        </button>
                    ))}
                </div>
                {(isCustom || activeEstimate) ? (() => {
                    const fiatStr = activeEstimate && typeof formatFiat === 'function'
                        ? formatFiat(activeEstimate.coinAmount)
                        : null;
                    return (
                        <div className={styles.sliderReadout} role="status" aria-live="polite">
                            <span className={styles.sliderReadoutPrimary}>
                                {activeEstimate ? (
                                    <>
                                        {activeEstimate.coinAmount}
                                        {coinTicker ? (
                                            <span className={styles.sliderReadoutCoin}> {coinTicker}</span>
                                        ) : null}
                                        {fiatStr ? (
                                            <span className={styles.sliderReadoutFiat}>{fiatStr}</span>
                                        ) : null}
                                    </>
                                ) : null}
                            </span>
                            {isCustom ? (
                                <span className={styles.customRow}>
                                    <input
                                        id={customInputId}
                                        type="number"
                                        inputMode="decimal"
                                        min={0}
                                        step={tiers.unit === 'DOGE/kB' ? 1 : 0.1}
                                        className={styles.customInput}
                                        value={Number.isFinite(value?.customRate) ? value.customRate : ''}
                                        onChange={(e) => onCustomRateChange(e.target.value)}
                                        aria-label={`Custom fee rate (${tiers.unit})`}
                                        disabled={disabled}
                                        autoFocus
                                    />
                                    <span className={styles.customUnit}>{tiers.unit}</span>
                                </span>
                            ) : (
                                <span className={styles.sliderReadoutRate}>{activeEstimate.rate}</span>
                            )}
                        </div>
                    );
                })() : null}
            </div>
        </div>
    );
}
