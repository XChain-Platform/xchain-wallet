import { useId, useMemo } from 'react';
import { InfoTip } from './InfoTip.jsx';
import styles from './FeeSelector.module.css';

const SPEEDS = ['low', 'normal', 'fast'];
const SPEED_LABELS = { low: 'Low', normal: 'Normal', fast: 'Fast' };

/**
 * FeeSelector — §44.2 Low / Normal / Fast slider + separate Custom
 * toggle. Rendering is driven by `tiers` from
 * `flows/feeEstimate.estimateNativeSendFeeTiers`; selection writes
 * back via `onChange`.
 *
 * The slider has three discrete stops (low / normal / fast); the
 * active stop's rate + ETA + fee amount are shown below the track. A
 * checkbox underneath flips the picker into Custom mode, hiding the
 * slider and revealing a sat/vB (or equivalent) input.
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
 *   - disabled   `boolean`
 *   - placeholderBadge  `boolean` — when true, renders a "(placeholder rate)" hint under the tiers; surfaces use this until §44 SDK fee fetch lands
 *
 * @typedef {object} FeeSelectorValue
 * @property {'low' | 'normal' | 'fast' | 'custom'} mode
 * @property {number} [customRate]   in chain's native unit (sat/vB or koinu/byte)
 */
export function FeeSelector({
    tiers,
    value,
    onChange,
    disabled = false,
    placeholderBadge = false,
    formatFiat,
}) {
    const labelId = useId();
    const customInputId = useId();
    const customToggleId = useId();

    const tierList = useMemo(() => {
        if (!tiers) return [];
        return SPEEDS
            .map((speed) => ({ speed, estimate: tiers[speed] }))
            .filter((t) => t.estimate);
    }, [tiers]);

    if (!tiers || tierList.length === 0) {
        return (
            <div className={styles.wrap}>
                <span className={styles.label} id={labelId}>Network fee</span>
                <p className={styles.placeholder}>Fee estimate unavailable for this chain.</p>
            </div>
        );
    }

    const mode = value?.mode || 'normal';
    const isCustom = mode === 'custom';
    const sliderSpeed = isCustom ? 'normal' : (SPEEDS.includes(mode) ? mode : 'normal');
    const sliderIndex = SPEEDS.indexOf(sliderSpeed);
    const activeEstimate = tiers[sliderSpeed];

    const onSliderChange = (raw) => {
        const i = Number(raw);
        const nextSpeed = SPEEDS[Math.max(0, Math.min(2, i))] || 'normal';
        onChange({ mode: nextSpeed });
    };

    const onCustomToggle = (checked) => {
        if (checked) {
            onChange({
                mode: 'custom',
                customRate: value?.customRate ?? tiers.normal?.rateValue,
            });
        } else {
            onChange({ mode: 'normal' });
        }
    };

    const onCustomRateChange = (raw) => {
        const n = parseFloat(raw);
        onChange({ mode: 'custom', customRate: Number.isFinite(n) ? n : 0 });
    };

    return (
        <div className={styles.wrap}>
            <span className={styles.label} id={labelId}>
                Network fee
                <InfoTip
                    aria="Network fee help"
                    label="Higher fees confirm sooner. Low can take an hour or more under busy mempool conditions; Fast usually lands in the next 1–2 blocks. Custom lets you set a specific sat/vB rate."
                />
            </span>

            {!isCustom ? (
                <div className={styles.sliderBlock} data-active-speed={sliderSpeed}>
                    <input
                        type="range"
                        min={0}
                        max={2}
                        step={1}
                        value={sliderIndex}
                        onChange={(e) => onSliderChange(e.target.value)}
                        disabled={disabled}
                        aria-labelledby={labelId}
                        aria-valuetext={`${SPEED_LABELS[sliderSpeed]} — ${activeEstimate?.coinAmount ?? ''}${activeEstimate?.etaMinutes ? ` · ~${activeEstimate.etaMinutes} min` : ''}`}
                        className={styles.slider}
                    />
                    <div className={styles.sliderTicks} aria-hidden="true">
                        {SPEEDS.map((s) => (
                            <button
                                key={s}
                                type="button"
                                className={`${styles.sliderTick} ${sliderSpeed === s ? styles.sliderTickActive : ''}`.trim()}
                                onClick={() => onChange({ mode: s })}
                                disabled={disabled}
                                tabIndex={-1}
                            >
                                {SPEED_LABELS[s]}
                            </button>
                        ))}
                    </div>
                    {activeEstimate ? (() => {
                        const fiatStr = typeof formatFiat === 'function'
                            ? formatFiat(activeEstimate.coinAmount)
                            : null;
                        return (
                            <div className={styles.sliderReadout} role="status" aria-live="polite">
                                <span className={styles.sliderReadoutPrimary}>
                                    {activeEstimate.coinAmount}
                                    {fiatStr ? (
                                        <span className={styles.sliderReadoutFiat}> ({fiatStr})</span>
                                    ) : null}
                                    {activeEstimate.etaMinutes ? (
                                        <span className={styles.sliderReadoutEta}> · ~{activeEstimate.etaMinutes} min</span>
                                    ) : null}
                                </span>
                                <span className={styles.sliderReadoutRate}>{activeEstimate.rate}</span>
                            </div>
                        );
                    })() : null}
                </div>
            ) : null}

            <label className={styles.customToggle} htmlFor={customToggleId}>
                <input
                    id={customToggleId}
                    type="checkbox"
                    role="switch"
                    checked={isCustom}
                    onChange={(e) => onCustomToggle(e.target.checked)}
                    disabled={disabled}
                />
                <span className={styles.customToggleLabel}>Custom rate</span>
            </label>

            {isCustom ? (
                <div className={styles.customRow}>
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
                    />
                    <span className={styles.customUnit}>{tiers.unit}</span>
                </div>
            ) : null}

            {placeholderBadge ? (
                <p className={styles.placeholder}>
                    Placeholder rates — real SDK fee estimation lands in a later step.
                </p>
            ) : null}
        </div>
    );
}
