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

const TIER_SPEEDS = ['low', 'normal', 'fast'];
const SPEEDS_WITH_CUSTOM = [...TIER_SPEEDS, 'custom'];
const SPEED_LABELS = { low: 'Low', normal: 'Normal', fast: 'Fast', custom: 'Custom' };

/**
 * FeeSelector (§44.2): Low / Normal / Fast / Custom tier selector.
 * Rendering is driven by `tiers` from
 * `flows/feeEstimate.estimateNativeSendFeeTiers`; selection writes
 * back via `onChange`.
 *
 * Three preset tiers are shown as a radiogroup. When the user picks
 * Custom, a rate input appears in place of the readout so the rate can
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
 *                     in the same readout slot the tier modes use.
 *   - disabled   `boolean`
 *   - placeholderBadge  `boolean` - when true, renders a notice that rates
 *                        are placeholder estimates, not live chain data.
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
    placeholderBadge = false,
}) {
    const labelId = useId();
    const SPEEDS = allowCustom ? SPEEDS_WITH_CUSTOM : TIER_SPEEDS;

    const tierList = useMemo(() => {
        if (!tiers) return [];
        return TIER_SPEEDS
            .map((speed) => ({ speed, estimate: tiers[speed] }))
            .filter((t) => t.estimate);
    }, [tiers]);

    if (!tiers || tierList.length === 0) {
        return (
            <div className={styles.wrap}>
                {label ? <span id={labelId} className={styles.label}>{label}</span> : null}
                <p className={styles.placeholder}>Fee estimate unavailable for this chain.</p>
            </div>
        );
    }

    const mode = value?.mode || 'normal';
    const isCustom = allowCustom && mode === 'custom';
    const activeEstimate = isCustom ? customEstimate : tiers[mode];

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

    const onCustomRateChange = (raw) => {
        const n = parseFloat(raw);
        onChange({ mode: 'custom', customRate: Number.isFinite(n) ? n : 0 });
    };

    const fiatStr = activeEstimate && typeof formatFiat === 'function'
        ? formatFiat(activeEstimate.coinAmount)
        : null;

    return (
        <div className={styles.wrap}>
            {label ? <span id={labelId} className={styles.label}>{label}</span> : null}
            {placeholderBadge ? (
                <p className={styles.placeholder}>Placeholder rates - live estimates unavailable</p>
            ) : null}
            <div
                role="radiogroup"
                aria-labelledby={labelId}
                className={styles.tiers}
            >
                {SPEEDS.map((speed) => {
                    const active = mode === speed;
                    const estimate = tiers[speed];
                    return (
                        <button
                            key={speed}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            className={`${styles.tier} ${active ? styles.tierActive : ''}`}
                            onClick={() => pickSpeed(speed)}
                            disabled={disabled}
                        >
                            <span className={styles.tierName}>{SPEED_LABELS[speed]}</span>
                            {estimate ? (
                                <>
                                    <span className={styles.tierRate}>{estimate.rate}</span>
                                    <span className={styles.tierFee}>{estimate.coinAmount}</span>
                                    {estimate.etaMinutes ? (
                                        <span className={styles.tierEta}>~{estimate.etaMinutes} min</span>
                                    ) : null}
                                </>
                            ) : null}
                        </button>
                    );
                })}
            </div>
            {isCustom ? (
                <div className={styles.customRow}>
                    <input
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
                </div>
            ) : null}
            {activeEstimate ? (
                <p className={styles.placeholder} role="status" aria-live="polite">
                    {activeEstimate.coinAmount}
                    {fiatStr ? ` (${fiatStr})` : ''}
                    {activeEstimate.etaMinutes ? ` · ~${activeEstimate.etaMinutes} min` : ''}
                </p>
            ) : null}
        </div>
    );
}
