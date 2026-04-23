import { useState } from 'react';
import styles from './CopyButton.module.css';

/**
 * Copies `value` to the system clipboard and briefly shows a confirmation
 * state. If the Clipboard API is unavailable (or blocked), the button
 * silently no-ops — callers that require a fallback should surface an
 * alternate path (manual-selection hint, QR).
 *
 * @param {object} props
 * @param {string} props.value
 * @param {string} [props.label]
 * @param {string} [props.ariaLabel]
 * @param {number} [props.feedbackMs]
 */
export function CopyButton({ value, label = 'Copy', ariaLabel, feedbackMs = 1500 }) {
    const [copied, setCopied] = useState(false);
    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), feedbackMs);
        } catch {
            /* clipboard unavailable — caller surfaces the fallback */
        }
    }
    return (
        <button
            type="button"
            onClick={handleCopy}
            className={styles.btn}
            aria-label={ariaLabel || label}
            aria-live="polite"
        >
            {copied ? 'Copied' : label}
        </button>
    );
}
