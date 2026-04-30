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

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import styles from './InfoTip.module.css';

// Default bubble width assumptions, kept in sync with the CSS clamp
// (`.bubble { min-width: 180px; max-width: 260px }`). A measurement-
// driven layout would be more precise, but the bubble is opt-in and
// reads as a band of width somewhere in this range; the half-width
// constant just decides which side overflows for re-anchoring.
const BUBBLE_HALF_WIDTH = 130; // ≈ max-width / 2

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.label   bubble content
 * @param {string} [props.aria]                    `aria-label` for the trigger button (defaults to "More info")
 * @param {'top' | 'bottom'} [props.placement]     bubble side; default 'top'
 * @param {string} [props.className]               extra classes appended to the wrapper
 */
export function InfoTip({ label, aria = 'More info', placement = 'top', className }) {
    const [open, setOpen] = useState(false);
    // Cluster P FOLLOWUP 3 — alignment is measured at open time so the
    // bubble re-anchors to the start / end of the trigger when its
    // center-anchored extent would clip the viewport. Default 'center'
    // matches the v0.210.0 layout for triggers that comfortably fit.
    const [align, setAlign] = useState(/** @type {'start' | 'center' | 'end'} */ ('center'));
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

    // Re-anchor on every open transition (and on viewport resize while
    // open). useLayoutEffect runs before the browser paints the bubble
    // so the user never sees a flash of clipped layout, then re-paint
    // with the corrected alignment class.
    useLayoutEffect(() => {
        if (!open) return undefined;
        const recompute = () => {
            const node = wrapRef.current;
            if (!node) return;
            const rect = node.getBoundingClientRect();
            const center = rect.left + rect.width / 2;
            const viewportWidth =
                (typeof document !== 'undefined' && document.documentElement?.clientWidth) ||
                (typeof window !== 'undefined' && window.innerWidth) ||
                0;
            if (viewportWidth <= 0) {
                setAlign('center');
                return;
            }
            if (center - BUBBLE_HALF_WIDTH < 0) {
                setAlign('start');
            } else if (center + BUBBLE_HALF_WIDTH > viewportWidth) {
                setAlign('end');
            } else {
                setAlign('center');
            }
        };
        recompute();
        const onResize = () => recompute();
        if (typeof window !== 'undefined') window.addEventListener('resize', onResize);
        return () => {
            if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
        };
    }, [open]);

    const cls = [styles.wrap, className].filter(Boolean).join(' ');
    const alignClass = align === 'start'
        ? styles.alignStart
        : align === 'end'
            ? styles.alignEnd
            : styles.alignCenter;

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
                    className={`${styles.bubble} ${placement === 'bottom' ? styles.placementBottom : styles.placementTop} ${alignClass}`}
                >
                    {label}
                </span>
            ) : null}
        </span>
    );
}
