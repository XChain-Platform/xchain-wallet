// InfoTip — §37 / G122 contextual tooltip.
//
// Self-contained "?" affordance that surfaces a short explanation
// without claiming layout space inside a form row. Keyboard reachable
// (Tab to focus, Enter / Space to open, Esc to close), screen-reader
// announced via `aria-describedby`, and dismisses on focus loss /
// outside click so a stale bubble doesn't shadow other controls.
//
// Sized for the kinds of unfamiliar elements §37 calls out — fee
// estimator tiers, RBF, derivation paths, BIP39 passphrase, ADS
// thresholds. Not a replacement for inline help that the user must
// read; the bubble is opt-in and dismissible.
//
// Renders as an inline `<span>` so it can sit beside a `<label>` or a
// `<span>` without breaking flow. The trigger is a real `<button>`
// (type="button") so it doesn't accidentally submit forms, and so it
// inherits the host's focus styling.

import { useEffect, useId, useRef, useState } from 'react';
import styles from './InfoTip.module.css';

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.label   bubble content
 * @param {string} [props.aria]                    `aria-label` for the trigger button (defaults to "More info")
 * @param {'top' | 'bottom'} [props.placement]     bubble side; default 'top'
 * @param {string} [props.className]               extra classes appended to the wrapper
 */
export function InfoTip({ label, aria = 'More info', placement = 'top', className }) {
    const [open, setOpen] = useState(false);
    const id = useId();
    const wrapRef = useRef(/** @type {HTMLSpanElement | null} */ (null));

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
        const onPointer = (event) => {
            if (!wrapRef.current) return;
            if (!wrapRef.current.contains(event.target)) setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('touchstart', onPointer, { passive: true });
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('touchstart', onPointer);
        };
    }, [open]);

    const cls = [styles.wrap, className].filter(Boolean).join(' ');

    return (
        <span ref={wrapRef} className={cls}>
            <button
                type="button"
                className={styles.trigger}
                aria-label={aria}
                aria-describedby={open ? id : undefined}
                aria-expanded={open}
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((v) => !v);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpen((v) => !v);
                    }
                }}
            >
                ?
            </button>
            {open ? (
                <span
                    id={id}
                    role="tooltip"
                    className={`${styles.bubble} ${placement === 'bottom' ? styles.placementBottom : styles.placementTop}`}
                >
                    {label}
                </span>
            ) : null}
        </span>
    );
}
