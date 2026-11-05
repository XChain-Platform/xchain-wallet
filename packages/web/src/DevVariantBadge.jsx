// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { setActiveVariant, clearVariantOverride, THRESHOLD_PX } from './devVariant.js';
import styles from './DevVariantBadge.module.css';
import { t } from '../../core/src/i18n/index.js';
import { POS_KEY } from './devVariantBadgeKey.js';


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

// The room the shell navigation takes at the badge's default corner: the
// inline size of a full-height rail on the inline-start edge and the block
// size of a full-width bar on the bottom edge. Every nav landmark counts, so
// the badge clears Lock and the tabs in every shell and locale.
function navClearance(el) {
    if (typeof window === 'undefined' || !el) return { inline: 0, block: 0, rtl: false };
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const rtl = window.getComputedStyle(el).direction === 'rtl';
    let inline = 0;
    let block = 0;
    for (const nav of document.querySelectorAll('nav')) {
        if (el.contains(nav)) continue;
        const r = nav.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.height > viewH / 2) {
            if (!rtl && r.left <= 1) inline = Math.max(inline, r.right);
            if (rtl && r.right >= viewW - 1) inline = Math.max(inline, viewW - r.left);
        } else if (r.width > viewW / 2 && r.bottom >= viewH - 1) {
            block = Math.max(block, viewH - r.top);
        }
    }
    return { inline: Math.round(inline), block: Math.round(block), rtl };
}

// Keeps a saved or dragged position inside the viewport and off the shell
// navigation, so the badge never covers Lock, the rail or a bottom tab.
function clampToViewport(p, el) {
    if (typeof window === 'undefined' || !el) return p;
    const rect = el.getBoundingClientRect();
    const clear = navClearance(el);
    const minX = clear.rtl ? 0 : clear.inline;
    const maxX = Math.max(minX, window.innerWidth - rect.width - 4 - (clear.rtl ? clear.inline : 0));
    const maxY = Math.max(0, window.innerHeight - clear.block - rect.height - 4);
    return { x: Math.min(Math.max(minX, p.x), maxX), y: Math.min(Math.max(0, p.y), maxY) };
}

/**
 * Floating dev-only badge that surfaces which layout variant is
 * active, why (auto-by-viewport vs forced override), the current
 * viewport width, and lets the designer pick a variant from a
 * dropdown or clear the override with one click.
 *
 * Variants:
 *   small      : mobile browser portrait / narrow desktop / future native app (375x600 frame; bottom tab bar)
 *   full       : desktop browser / tablet landscape / electron / extension full-screen tab (no frame; left nav)
 *   sidebar    : Chrome MV3 side panel (right-docked 375 column; full viewport height)
 *   extension  : Chrome extension toolbar popup (360x600 fixed; no bottom tab bar, drawer only)
 *
 * A forced variant lives in the `variant` query parameter and nowhere
 * else, so it lasts exactly as long as the URL does.
 *
 * Drag the grip (⠿) on the left to reposition; the chosen position
 * persists in localStorage and survives reload. Default position is
 * the bottom-left corner.
 *
 * @param {object} props
 * @param {{ variant: 'small' | 'full' | 'sidebar' | 'extension', source: 'url' | 'auto', viewportPx: number }} props.state
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

    const [clear, setClear] = useState({ inline: 0, block: 0 });

    // Pulls the saved position back on screen and off the navigation.
    function reclamp() {
        const cur = posRef.current;
        if (!cur || !badgeRef.current) return;
        const clamped = clampToViewport(cur, badgeRef.current);
        if (clamped.x !== cur.x || clamped.y !== cur.y) {
            posRef.current = clamped;
            setPos(clamped);
            writePos(clamped);
        }
    }

    // Clamp a saved position before the first paint, so a seed left off
    // screen by a larger window or a hand edit never renders out of reach.
    useLayoutEffect(() => { reclamp(); }, []);

    // Keep the badge clear of the navigation as the shell mounts, swaps the
    // rail for the bottom bar, or changes direction.
    useLayoutEffect(() => {
        let frame = 0;
        function measure() {
            frame = 0;
            const next = navClearance(badgeRef.current);
            setClear((prev) => (prev.inline === next.inline && prev.block === next.block ? prev : next));
            reclamp();
        }
        function schedule() {
            if (!frame) frame = window.requestAnimationFrame(measure);
        }
        measure();
        const observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['dir'],
        });
        window.addEventListener('resize', schedule);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', schedule);
            if (frame) window.cancelAnimationFrame(frame);
        };
    }, []);

    // Re-clamp if the viewport shrinks past a saved off-screen position.
    useEffect(() => {
        window.addEventListener('resize', reclamp);
        return () => window.removeEventListener('resize', reclamp);
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
        // Eager persist: guarantees the latest position survives a
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
        : { '--xc-badge-clear-inline': `${clear.inline}px`, '--xc-badge-clear-block': `${clear.block}px` };

    return (
        <div
            ref={badgeRef}
            className={styles.badge}
            style={styleOverride}
            role="status"
            aria-label={t('shell.devVariantBadge.devVariant', { variant })}
        >
            <span
                className={styles.grip}
                onPointerDown={onGripDown}
                onPointerMove={onGripMove}
                onPointerUp={onGripUp}
                onPointerCancel={onGripUp}
                title={t('shell.devVariantBadge.dragToMove')}
                aria-hidden="true"
            >
                ⠿
            </span>
            <span className={styles.label}>{t('shell.devVariantBadge.variant')}</span>
            <span className={`${styles.value} ${styles[variant]}`}>{variant}</span>
            <span className={styles.dims} title={t('shell.devVariantBadge.thresholdPx', { THRESHOLD_PX })}>
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
                title={t('shell.devVariantBadge.pickVariant')}
                aria-label={t('shell.devVariantBadge.pickVariant')}
            >
                <option value="__auto">{t('shell.devVariantBadge.autoByViewport')}</option>
                <option value="small">{t('shell.devVariantBadge.smallMobile')}</option>
                <option value="full">{t('shell.devVariantBadge.fullDesktop')}</option>
                <option value="sidebar">{t('shell.devVariantBadge.sidebarChromePanel')}</option>
                <option value="extension">{t('shell.devVariantBadge.extensionChromePopup')}</option>
            </select>
        </div>
    );
}
