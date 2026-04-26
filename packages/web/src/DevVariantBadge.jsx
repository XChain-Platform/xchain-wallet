import { setActiveVariant, clearVariantOverride, THRESHOLD_PX } from './devVariant.js';
import styles from './DevVariantBadge.module.css';

/**
 * Floating dev-only badge that surfaces which layout variant is
 * active, why (auto-by-viewport vs forced override), the current
 * viewport width, and lets the designer flip variants or clear the
 * override with one click.
 *
 * @param {object} props
 * @param {{ variant: 'small' | 'full', source: 'url' | 'storage' | 'auto', viewportPx: number }} props.state
 */
export function DevVariantBadge({ state }) {
    const { variant, source, viewportPx } = state;
    const next = variant === 'small' ? 'full' : 'small';
    const sourceLabel = source === 'auto'
        ? `auto · ${viewportPx}px`
        : `forced · ${viewportPx}px`;
    return (
        <div className={styles.badge} role="status" aria-label={`Dev variant: ${variant}`}>
            <span className={styles.label}>variant</span>
            <span className={`${styles.value} ${styles[variant]}`}>{variant}</span>
            <span className={styles.dims} title={`Threshold: ${THRESHOLD_PX}px`}>
                {sourceLabel}
            </span>
            <button
                type="button"
                className={styles.flip}
                onClick={() => setActiveVariant(next)}
                title={`Force ${next}`}
            >
                ⇄ {next}
            </button>
            {source !== 'auto' ? (
                <button
                    type="button"
                    className={styles.clear}
                    onClick={() => clearVariantOverride()}
                    title="Reset to auto-by-viewport"
                >
                    auto
                </button>
            ) : null}
        </div>
    );
}
