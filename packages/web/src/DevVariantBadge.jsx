import { useEffect, useRef, useState } from 'react';
import { setActiveVariant, clearVariantOverride, THRESHOLD_PX } from './devVariant.js';
import styles from './DevVariantBadge.module.css';

const POS_KEY = 'xc.devVariantBadge.pos';

function readPos() {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(POS_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
    } catch { /* ignore */ }
    return null;
}

function writePos(p) {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

function clampToViewport(p, el) {
    if (typeof window === 'undefined' || !el) return p;
    const rect = el.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - rect.width - 4);
    const maxY = Math.max(0, window.innerHeight - rect.height - 4);
    return { x: Math.min(Math.max(0, p.x), maxX), y: Math.min(Math.max(0, p.y), maxY) };
}

/**
 * Floating dev-only badge that surfaces which layout variant is
 * active, why (auto-by-viewport vs forced override), the current
 * viewport width, and lets the designer pick a variant from a
 * dropdown or clear the override with one click.
 *
 * Variants:
 *   small      — mobile browser portrait / narrow desktop / future native app (375×600 frame; bottom tab bar)
 *   full       — desktop browser / tablet landscape / electron / extension full-screen tab (no frame; left nav)
 *   sidebar    — Chrome MV3 side panel (right-docked 375 column; full viewport height)
 *   extension  — Chrome extension toolbar popup (360×600 fixed; no bottom tab bar — drawer only)
 *
 * Drag the grip (⠿) on the left to reposition; the chosen position
 * persists in localStorage and survives reload. Default position is
 * the bottom-left corner.
 *
 * @param {object} props
 * @param {{ variant: 'small' | 'full' | 'sidebar' | 'extension', source: 'url' | 'storage' | 'auto', viewportPx: number }} props.state
 */
export function DevVariantBadge({ state }) {
    const { variant, source, viewportPx } = state;
    const sourceLabel = source === 'auto'
        ? `auto · ${viewportPx}px`
        : `forced · ${viewportPx}px`;

    const badgeRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const dragRef = useRef(/** @type {{ startX: number, startY: number, baseLeft: number, baseTop: number } | null} */ (null));
    const [pos, setPos] = useState(/** @type {{ x: number, y: number } | null} */ (() => readPos()));
    const posRef = useRef(pos);
    useEffect(() => { posRef.current = pos; }, [pos]);

    // Re-clamp if the viewport shrinks past a saved off-screen position.
    useEffect(() => {
        function onResize() {
            const cur = posRef.current;
            if (!cur || !badgeRef.current) return;
            const clamped = clampToViewport(cur, badgeRef.current);
            if (clamped.x !== cur.x || clamped.y !== cur.y) {
                setPos(clamped);
                writePos(clamped);
            }
        }
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    function onGripDown(e) {
        if (!badgeRef.current) return;
        const rect = badgeRef.current.getBoundingClientRect();
        dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            baseLeft: rect.left,
            baseTop: rect.top,
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.preventDefault();
    }

    function onGripMove(e) {
        const d = dragRef.current;
        if (!d || !badgeRef.current) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        const next = clampToViewport({ x: d.baseLeft + dx, y: d.baseTop + dy }, badgeRef.current);
        setPos(next);
        // Eager persist — guarantees the latest position survives a
        // page reload (which fires synchronously when the user picks a
        // new variant from the dropdown) without a stale-state race
        // between setPos and onGripUp.
        writePos(next);
    }

    function onGripUp(e) {
        if (!dragRef.current) return;
        dragRef.current = null;
        try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    }

    const styleOverride = pos
        ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto' }
        : undefined;

    return (
        <div
            ref={badgeRef}
            className={styles.badge}
            style={styleOverride}
            role="status"
            aria-label={`Dev variant: ${variant}`}
        >
            <span
                className={styles.grip}
                onPointerDown={onGripDown}
                onPointerMove={onGripMove}
                onPointerUp={onGripUp}
                onPointerCancel={onGripUp}
                title="Drag to move"
                aria-hidden="true"
            >
                ⠿
            </span>
            <span className={styles.label}>variant</span>
            <span className={`${styles.value} ${styles[variant]}`}>{variant}</span>
            <span className={styles.dims} title={`Threshold: ${THRESHOLD_PX}px`}>
                {sourceLabel}
            </span>
            <select
                className={styles.picker}
                value={source === 'auto' ? '__auto' : variant}
                onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__auto') clearVariantOverride();
                    else setActiveVariant(v);
                }}
                title="Pick variant"
                aria-label="Pick variant"
            >
                <option value="__auto">auto · by viewport</option>
                <option value="small">small · mobile</option>
                <option value="full">full · desktop</option>
                <option value="sidebar">sidebar · chrome panel</option>
                <option value="extension">extension · chrome popup</option>
            </select>
        </div>
    );
}
