import { useId, useMemo } from 'react';
import { InfoTip } from './InfoTip.jsx';
import styles from './FeeSelector.module.css';

/**
 * FeeSelector — §44.2 Low / Normal / Fast preset buttons + Custom
 * rate input. Rendering is driven by `tiers` from
 * `flows/feeEstimate.estimateNativeSendFeeTiers`; selection writes
 * back via `onChange`.
 *
 * The component is presentation-only — it does NOT compute fees
 * itself. Callers fetch tiers via `estimateNativeSendFeeTiers` and
 * pass them in; the selected tier (or custom rate) flows back via
 * `onChange({ speed | 'custom', rate?, estimate? })`.
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
}) {
    const labelId = useId();
    const customId = useId();

    const tierList = useMemo(() => {
        if (!tiers) return [];
        return [
            { speed: 'low', estimate: tiers.low },
            { speed: 'normal', estimate: tiers.normal },
            { speed: 'fast', estimate: tiers.fast },
        ].filter((t) => t.estimate);
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

    const onTierClick = (speed) => {
        onChange({ mode: speed });
    };

    const onCustomToggle = () => {
        onChange({ mode: 'custom', customRate: value?.customRate ?? tiers.normal?.rateValue });
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
            <div role="radiogroup" aria-labelledby={labelId} className={styles.tiers}>
                {tierList.map(({ speed, estimate }) => {
                    const active = mode === speed;
                    return (
                        <button
                            key={speed}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            disabled={disabled}
                            className={`${styles.tier} ${active ? styles.tierActive : ''}`.trim()}
                            onClick={() => onTierClick(speed)}
                        >
                            <span className={styles.tierName}>{estimate.speed === 'low' ? 'Low' : estimate.speed === 'fast' ? 'Fast' : 'Normal'}</span>
                            <span className={styles.tierRate}>{estimate.rate}</span>
                            <span className={styles.tierFee}>{estimate.coinAmount}</span>
                            {estimate.etaMinutes ? (
                                <span className={styles.tierEta}>~{estimate.etaMinutes} min</span>
                            ) : null}
                        </button>
                    );
                })}
                <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'custom'}
                    disabled={disabled}
                    className={`${styles.tier} ${mode === 'custom' ? styles.tierActive : ''}`.trim()}
                    onClick={onCustomToggle}
                >
                    <span className={styles.tierName}>Custom</span>
                    <span className={styles.tierRate}>{tiers.unit}</span>
                </button>
            </div>
            {mode === 'custom' ? (
                <div className={styles.customRow}>
                    <input
                        id={customId}
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
