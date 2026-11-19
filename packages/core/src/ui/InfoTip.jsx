// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// InfoTip: §37 / G122 contextual tooltip.
//
// Self-contained "?" affordance that surfaces a short explanation
// without claiming layout space inside a form row. Keyboard reachable
// (Tab to focus, Enter / Space to open, Esc to close), screen-reader
// announced via `aria-describedby`, and dismisses on focus loss /
// outside click so a stale bubble doesn't shadow other controls.
//
// Sized for the kinds of unfamiliar elements §37 calls out: fee
// estimator tiers, RBF, derivation paths, BIP39 passphrase, ADS
// thresholds. Not a replacement for inline help that the user must
// read; the bubble is opt-in and dismissible.
//
// Renders as an inline `<span>` so it can sit beside a `<label>` or a
// `<span>` without breaking flow. The trigger is a real `<button>`
// (type="button") so it doesn't accidentally submit forms, and so it
// inherits the host's focus styling.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
// Imported ahead of InfoTip's own sheet so the shared button base always
// loads first and the trigger's rules follow it. A CSS-file `composes` would
// inline a second copy of Button.module.css into InfoTip's sheet, and that
// copy re-asserts .btn over every module loaded before it, real buttons
// included.
import buttonStyles from './Button.module.css';
import styles from './InfoTip.module.css';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/ui.js';

const VIEWPORT_MARGIN = 8;
const BUBBLE_GAP = 6;

function shellVisibleBounds(viewportTop, viewportBottom) {
    const headerControl = document.querySelector('[data-header-control]');
    const appHeader = headerControl?.closest('[role="region"]')
        || document.querySelector('[role="region"][aria-label="App header"]');
    const bottomTab = document.querySelector('[data-bottom-tab]');
    const bottomBar = bottomTab?.closest('nav')
        || document.querySelector('nav[aria-label="Bottom navigation"]');
    const headerBottom = appHeader?.getBoundingClientRect().bottom;
    const bottomBarTop = bottomBar?.getBoundingClientRect().top;
    let top = Number.isFinite(headerBottom) && headerBottom > viewportTop && headerBottom < viewportBottom
        ? headerBottom
        : viewportTop;

    // Screen wraps PageHeader's h1 in a semantic header outside its scrolling
    // body. Count it only while it meets the visible top chrome; in short
    // landscape layouts the whole Screen can scroll, taking this header away.
    for (const pageHeader of document.querySelectorAll('header')) {
        if (!pageHeader.querySelector('h1')) continue;
        const rect = pageHeader.getBoundingClientRect();
        if (
            Number.isFinite(rect.top)
            && Number.isFinite(rect.bottom)
            && rect.top <= top
            && rect.bottom > viewportTop
            && rect.bottom < viewportBottom
        ) {
            top = Math.max(top, rect.bottom);
        }
    }

    return {
        top,
        bottom: Number.isFinite(bottomBarTop) && bottomBarTop > viewportTop && bottomBarTop < viewportBottom
            ? bottomBarTop
            : viewportBottom,
    };
}

/**
 * Narrows the visible band to every ancestor that clips its overflow, such as
 * the screen's scrolling body: a bubble that opens past that edge is cut off
 * even when the viewport has room.
 */
function clippedBounds(node, bounds) {
    let { top, bottom } = bounds;
    for (let el = node?.parentElement; el && el !== document.body; el = el.parentElement) {
        const overflowY = getComputedStyle(el).overflowY;
        if (overflowY === 'visible') continue;
        const rect = el.getBoundingClientRect();
        if (Number.isFinite(rect.top) && rect.top > top) top = rect.top;
        if (Number.isFinite(rect.bottom) && rect.bottom > 0 && rect.bottom < bottom) bottom = rect.bottom;
    }
    return { top, bottom };
}

/**
 * The same narrowing sideways: the screen body clips its horizontal overflow,
 * so beside a desktop sidebar the bubble must stay inside the body, not just
 * inside the viewport.
 */
function clippedSides(node, left, right) {
    for (let el = node?.parentElement; el && el !== document.body; el = el.parentElement) {
        const overflowX = getComputedStyle(el).overflowX;
        if (overflowX === 'visible') continue;
        const rect = el.getBoundingClientRect();
        if (!(rect.right > rect.left)) continue;
        if (Number.isFinite(rect.left) && rect.left > left) left = rect.left;
        if (Number.isFinite(rect.right) && rect.right < right) right = rect.right;
    }
    return { left, right };
}

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.label   bubble content
 * @param {string} [props.aria]                    `aria-label` for the trigger button (defaults to "More info")
 * @param {'top' | 'bottom'} [props.placement]     bubble side; default 'top'
 * @param {string} [props.className]               extra classes appended to the wrapper
 */
export function InfoTip({ label, aria = t('ui.infoTip.moreInfo'), placement = 'top', className }) {
    const [open, setOpen] = useState(false);
    const [side, setSide] = useState(placement);
    const [maxHeight, setMaxHeight] = useState(/** @type {number | null} */ (null));
    const [maxWidth, setMaxWidth] = useState(/** @type {number | null} */ (null));
    const [horizontalOffset, setHorizontalOffset] = useState(0);
    const id = useId();
    const wrapRef = useRef(/** @type {HTMLSpanElement | null} */ (null));
    const bubbleRef = useRef(/** @type {HTMLSpanElement | null} */ (null));

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
        const onPointer = (event) => {
            if (!wrapRef.current) return;
            if (!wrapRef.current.contains(event.target)) setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onPointer);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onPointer);
        };
    }, [open]);

    useLayoutEffect(() => {
        if (!open) return undefined;
        const recompute = () => {
            const node = wrapRef.current;
            const bubble = bubbleRef.current;
            if (!node || !bubble) return;
            const rect = node.getBoundingClientRect();
            const bubbleRect = bubble.getBoundingClientRect();
            const center = rect.left + rect.width / 2;
            const visualViewport = typeof window !== 'undefined' ? window.visualViewport : null;
            const viewportLeft = visualViewport?.offsetLeft || 0;
            const viewportTop = visualViewport?.offsetTop || 0;
            const viewportWidth =
                visualViewport?.width ||
                (typeof document !== 'undefined' && document.documentElement?.clientWidth) ||
                (typeof window !== 'undefined' && window.innerWidth) ||
                0;
            const viewportHeight =
                visualViewport?.height ||
                (typeof document !== 'undefined' && document.documentElement?.clientHeight) ||
                (typeof window !== 'undefined' && window.innerHeight) ||
                0;
            if (viewportWidth <= 0) {
                setMaxWidth(null);
                setHorizontalOffset(0);
            } else {
                const sides = clippedSides(node, viewportLeft, viewportLeft + viewportWidth);
                const availableWidth = Math.max(1, sides.right - sides.left - 2 * VIEWPORT_MARGIN);
                const widthLimit = Math.min(360, availableWidth);
                const bubbleWidth = Math.min(bubbleRect.width || widthLimit, widthLimit);
                const centeredLeft = center - bubbleWidth / 2;
                const minimumLeft = sides.left + VIEWPORT_MARGIN;
                const maximumLeft = sides.right - VIEWPORT_MARGIN - bubbleWidth;
                const clampedLeft = Math.min(Math.max(centeredLeft, minimumLeft), maximumLeft);
                setMaxWidth(widthLimit);
                setHorizontalOffset(clampedLeft - centeredLeft);
            }

            if (viewportHeight > 0) {
                const viewportBottom = viewportTop + viewportHeight;
                const visibleBounds = clippedBounds(node, shellVisibleBounds(viewportTop, viewportBottom));
                const spaceAbove = Math.max(0, rect.top - visibleBounds.top - BUBBLE_GAP - VIEWPORT_MARGIN);
                const spaceBelow = Math.max(0, visibleBounds.bottom - rect.bottom - BUBBLE_GAP - VIEWPORT_MARGIN);
                const preferredSpace = placement === 'top' ? spaceAbove : spaceBelow;
                const oppositeSpace = placement === 'top' ? spaceBelow : spaceAbove;
                const bubbleHeight = Math.max(bubbleRect.height, bubble.scrollHeight);
                const nextSide = bubbleHeight > preferredSpace && oppositeSpace > preferredSpace
                    ? (placement === 'top' ? 'bottom' : 'top')
                    : placement;
                setSide(nextSide);
                setMaxHeight(nextSide === 'top' ? spaceAbove : spaceBelow);
            }
        };
        recompute();
        const onResize = () => recompute();
        const visualViewport = typeof window !== 'undefined' ? window.visualViewport : null;
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', onResize);
            window.addEventListener('scroll', onResize, true);
        }
        visualViewport?.addEventListener('resize', onResize);
        visualViewport?.addEventListener('scroll', onResize);
        return () => {
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', onResize);
                window.removeEventListener('scroll', onResize, true);
            }
            visualViewport?.removeEventListener('resize', onResize);
            visualViewport?.removeEventListener('scroll', onResize);
        };
    }, [label, maxWidth, open, placement]);

    const cls = [styles.wrap, className].filter(Boolean).join(' ');

    return (
        <span ref={wrapRef} className={cls}>
            <button
                type="button"
                className={`${buttonStyles.btn} ${buttonStyles.link} ${buttonStyles.sm} ${styles.trigger}`}
                aria-label={aria}
                aria-describedby={id}
                aria-expanded={open}
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => {
                    if (!wrapRef.current?.contains(document.activeElement)) setOpen(false);
                }}
                onFocus={() => setOpen(true)}
                onBlur={(event) => {
                    if (!wrapRef.current?.contains(event.relatedTarget)) setOpen(false);
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(true);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpen(true);
                    }
                }}
            >
                {/* The painted dot. The button around it is bigger than
                    the dot on purpose (slice 2: 24px minimum tap
                    target), so the glyph carries the circle. */}
                <span className={styles.glyph} aria-hidden="true">?</span>
            </button>
            <span
                ref={bubbleRef}
                id={id}
                role="tooltip"
                hidden={!open}
                className={`${styles.bubble} ${side === 'bottom' ? styles.placementBottom : styles.placementTop}`}
                style={{
                    maxHeight: maxHeight === null ? undefined : `${maxHeight}px`,
                    minWidth: maxWidth === null ? undefined : `${Math.min(180, maxWidth)}px`,
                    maxWidth: maxWidth === null ? undefined : `${maxWidth}px`,
                    transform: `translateX(var(--xc-tip-center, -50%)) translateX(${horizontalOffset}px)`,
                }}
            >
                {label}
            </span>
        </span>
    );
}
