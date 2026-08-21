// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useId, useMemo, useState } from 'react';
import { isPerKbUnit } from '../flows/feeEstimate.js';
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
 * Both readout figures are click-to-edit (when `allowCustom`): clicking
 * the rate turns it into the Custom rate input, and clicking the fee
 * amount turns it into an exact-fee input. An exact fee is converted to
 * the equivalent rate (fee / vsize) before being emitted, so the
 * onChange contract stays `{ mode: 'custom', customRate }` and callers
 * recompute the estimate through the same custom-rate path. Either edit
 * snaps the slider to the Custom stop.
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
    const feeInputId = useId();
    // Exact-fee edit buffer. While non-null the fee readout renders as a
    // text input echoing exactly what the user typed (so "0.0" doesn't
    // get reformatted mid-keystroke); the derived rate flows out through
    // onChange on every change. Cleared on blur/Enter or when the user
    // moves the slider back to a preset tier.
    const [feeDraft, setFeeDraft] = useState(null);
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
            setFeeDraft(null);
            onChange({ mode: speed });
        }
    };

    // Convert an exact fee (coin-scale decimal) to the displayed-unit
    // rate that produces it. Prefers the estimate's vsize (exact inverse
    // of customFeeEstimate's sats = rate x vsize); falls back to the
    // rate/fee ratio of a known tier when vsize is absent (doc fixtures).
    const feeToDisplayRate = (fee) => {
        const ref = tiers.normal || tiers.fast || tiers.low;
        const vsize = activeEstimate?.vsize ?? ref?.vsize;
        if (Number.isFinite(vsize) && vsize > 0) {
            const raw = isPerKbUnit(tiers.unit)
                ? (fee * 1000) / vsize
                : (fee * 1e8) / vsize;
            return Number(raw.toFixed(8));
        }
        const refFee = parseFloat(ref?.coinAmount);
        if (Number.isFinite(ref?.rateValue) && Number.isFinite(refFee) && refFee > 0) {
            return Number(((fee * ref.rateValue) / refFee).toFixed(8));
        }
        return seedCustomRate();
    };

    const beginFeeEdit = () => {
        if (disabled || !allowCustom) return;
        setFeeDraft(activeEstimate?.coinAmount ?? '');
    };

    const onFeeDraftChange = (raw) => {
        setFeeDraft(raw);
        const n = parseFloat(raw);
        onChange({
            mode: 'custom',
            customRate: Number.isFinite(n) && n >= 0 ? feeToDisplayRate(n) : 0,
        });
    };

    // Click the tier rate readout to jump straight into Custom, seeded
    // with the tier's own rate so the input opens ready to tweak.
    const beginRateEdit = () => {
        if (disabled || !allowCustom) return;
        onChange({
            mode: 'custom',
            customRate: activeEstimate?.rateValue ?? seedCustomRate(),
        });
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
                {(isCustom || activeEstimate || feeDraft !== null) ? (() => {
                    const fiatStr = activeEstimate && typeof formatFiat === 'function'
                        ? formatFiat(activeEstimate.coinAmount)
                        : null;
                    const editingFee = feeDraft !== null;
                    return (
                        <div className={styles.sliderReadout} role="status" aria-live="polite">
                            <span className={styles.sliderReadoutPrimary}>
                                {editingFee ? (
                                    <span className={styles.customRow}>
                                        <input
                                            id={feeInputId}
                                            type="number"
                                            inputMode="decimal"
                                            min={0}
                                            step="any"
                                            className={`${styles.customInput} ${styles.feeInput}`}
                                            value={feeDraft}
                                            onChange={(e) => onFeeDraftChange(e.target.value)}
                                            onBlur={() => setFeeDraft(null)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                            aria-label={`Network fee amount${coinTicker ? ` (${coinTicker})` : ''}`}
                                            disabled={disabled}
                                            autoFocus
                                        />
                                        {coinTicker ? (
                                            <span className={styles.sliderReadoutCoin}>{coinTicker}</span>
                                        ) : null}
                                    </span>
                                ) : activeEstimate ? (
                                    <>
                                        {allowCustom ? (
                                            <button
                                                type="button"
                                                className={styles.readoutEdit}
                                                onClick={beginFeeEdit}
                                                disabled={disabled}
                                                aria-label="Edit exact fee amount"
                                                title="Click to edit the exact fee"
                                            >
                                                {activeEstimate.coinAmount}
                                            </button>
                                        ) : activeEstimate.coinAmount}
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
                                        step={isPerKbUnit(tiers.unit) ? 1 : 0.1}
                                        className={styles.customInput}
                                        value={Number.isFinite(value?.customRate) ? value.customRate : ''}
                                        onChange={(e) => onCustomRateChange(e.target.value)}
                                        aria-label={`Custom fee rate (${tiers.unit})`}
                                        disabled={disabled}
                                        autoFocus={!editingFee}
                                    />
                                    <span className={styles.customUnit}>{tiers.unit}</span>
                                </span>
                            ) : !activeEstimate ? null : allowCustom ? (
                                <button
                                    type="button"
                                    className={`${styles.readoutEdit} ${styles.sliderReadoutRate}`}
                                    onClick={beginRateEdit}
                                    disabled={disabled}
                                    aria-label={`Edit fee rate (${tiers.unit})`}
                                    title="Click to edit the fee rate"
                                >
                                    {activeEstimate.rate}
                                </button>
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
