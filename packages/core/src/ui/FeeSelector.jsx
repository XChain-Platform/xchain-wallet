import { useId, useMemo } from 'react';
import styles from './FeeSelector.module.css';

const TIER_SPEEDS = ['low', 'normal', 'fast'];
const SPEEDS = [...TIER_SPEEDS, 'custom'];
const SPEED_LABELS = { low: 'Low', normal: 'Normal', fast: 'Fast', custom: 'Custom' };
const MAX_INDEX = SPEEDS.length - 1;

/**
 * FeeSelector — §44.2 Low / Normal / Fast / Custom slider. Rendering
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
 * The component is presentation-only — it does NOT compute fees
 * itself. Callers fetch tiers via `estimateNativeSendFeeTiers` and
 * pass them in; the selected tier (or custom rate) flows back via
 * `onChange({ mode, customRate? })`.
 *
 * Props
 *   - tiers      `{ low, normal, fast, unit }` from estimateNativeSendFeeTiers
 *   - value      `{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }`
 *   - onChange   `(next) => void` — same shape as `value`
 *   - customEstimate  optional `FeeEstimate` for Custom mode — when provided,
 *                     its `coinAmount` + (via `formatFiat`) fiat figure render
 *                     in the same readout slot the tier modes use, so the live
 *                     fee stays visible as the user edits the rate.
 *   - disabled   `boolean`
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
}) {
    const customInputId = useId();

    const tierList = useMemo(() => {
        if (!tiers) return [];
        return TIER_SPEEDS
            .map((speed) => ({ speed, estimate: tiers[speed] }))
            .filter((t) => t.estimate);
    }, [tiers]);

    if (!tiers || tierList.length === 0) {
        return (
            <div className={styles.wrap}>
                <p className={styles.placeholder}>Fee estimate unavailable for this chain.</p>
            </div>
        );
    }

    const mode = value?.mode || 'normal';
    const isCustom = mode === 'custom';
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
                        ? `Custom — ${Number.isFinite(value?.customRate) ? value.customRate : ''} ${tiers.unit}`.trim()
                        : `${SPEED_LABELS[sliderSpeed]} — ${activeEstimate?.coinAmount ?? ''}${activeEstimate?.etaMinutes ? ` · ~${activeEstimate.etaMinutes} min` : ''}`}
                    className={styles.slider}
                />
                <div className={styles.sliderTicks} aria-hidden="true">
                    {SPEEDS.map((s) => (
                        <button
                            key={s}
                            type="button"
                            className={`${styles.sliderTick} ${sliderSpeed === s ? styles.sliderTickActive : ''}`.trim()}
                            onClick={() => pickSpeed(s)}
                            disabled={disabled}
                            tabIndex={-1}
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
                                        {fiatStr ? (
                                            <span className={styles.sliderReadoutFiat}> ({fiatStr})</span>
                                        ) : null}
                                        {activeEstimate.etaMinutes ? (
                                            <span className={styles.sliderReadoutEta}> · ~{activeEstimate.etaMinutes} min</span>
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
