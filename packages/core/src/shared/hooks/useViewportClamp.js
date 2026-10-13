// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useLayoutEffect, useRef, useState } from 'react';

/** Gap kept between a clamped popover and the viewport edge, in CSS px. */
export const VIEWPORT_CLAMP_MARGIN = 12;

/**
 * How far to slide a box sideways so it sits inside the viewport.
 *
 * Pure so the arithmetic is testable without a layout engine. A box wider
 * than the space between the margins is pinned to the leading margin: the
 * start of its content is the part that must stay reachable.
 *
 * @param {number} left     the box's unshifted left edge, viewport px
 * @param {number} width    the box's width, px
 * @param {number} viewportWidth
 * @param {number} [margin]
 * @returns {number} px to translate along X (0 when it already fits)
 */
export function clampShift(left, width, viewportWidth, margin = VIEWPORT_CLAMP_MARGIN) {
    const min = margin;
    const max = viewportWidth - margin;
    if (left < min || width > max - min) return Math.round(min - left);
    if (left + width > max) return Math.round(max - (left + width));
    return 0;
}

/** Gap between a trigger and the popover below it, in CSS px. */
export const ANCHORED_POPOVER_GAP = 6;

/**
 * Places a popover below with its right edge aligned to its trigger.
 *
 * The horizontal clamp keeps the panel reachable when the trigger sits too
 * close to either viewport edge. The panel CSS limits its width to the space
 * between those margins.
 *
 * @param {{ right: number, bottom: number }} triggerRect
 * @param {number} popoverWidth
 * @param {number} viewportWidth
 * @param {number} [margin]
 * @param {number} [gap]
 * @returns {{ left: number, top: number }} viewport-relative CSS px
 */
export function anchoredPopoverPlacement(
    triggerRect,
    popoverWidth,
    viewportWidth,
    margin = VIEWPORT_CLAMP_MARGIN,
    gap = ANCHORED_POPOVER_GAP,
) {
    const naturalLeft = triggerRect.right - popoverWidth;
    const maxLeft = Math.max(margin, viewportWidth - margin - popoverWidth);
    return {
        left: Math.round(Math.min(Math.max(naturalLeft, margin), maxLeft)),
        top: Math.round(triggerRect.bottom + gap),
    };
}

/**
 * Computes fixed popover coordinates from an anchor element.
 *
 * Fixed coordinates make the trigger the source of truth even when flex
 * wrapping changes the header's containing block on a narrow screen.
 *
 * @param {boolean} open
 * @param {import('react').RefObject<HTMLElement>} anchorRef
 * @returns {{ ref: import('react').RefObject<HTMLElement>, style: import('react').CSSProperties | undefined }}
 */
export function useAnchoredPopover(open, anchorRef) {
    const ref = useRef(/** @type {HTMLElement | null} */ (null));
    const [placement, setPlacement] = useState(null);

    useLayoutEffect(() => {
        if (!open) {
            setPlacement(null);
            return undefined;
        }
        const place = () => {
            const anchor = anchorRef.current;
            const popover = ref.current;
            if (!anchor || !popover) return;
            const next = anchoredPopoverPlacement(
                anchor.getBoundingClientRect(),
                popover.getBoundingClientRect().width,
                document.documentElement.clientWidth,
            );
            setPlacement((current) => (
                current?.left === next.left && current?.top === next.top ? current : next
            ));
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
    }, [anchorRef, open]);

    return {
        ref,
        style: placement ? {
            position: 'fixed',
            insetInlineEnd: 'auto',
            left: placement.left,
            top: placement.top,
            // Fixed coordinates skip the body's safe-area padding, so the width
            // cap also leaves room for a landscape notch on either side.
            maxWidth: 'calc(100vw - ' + String(2 * VIEWPORT_CLAMP_MARGIN) + 'px'
                + ' - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px))',
        } : undefined,
    };
}

/**
 * Keeps an anchored popover on screen.
 *
 * A popover that is absolutely positioned against its trigger lands wherever
 * the trigger is. In a phone-width header the trigger can sit near either
 * edge, and a fixed-width panel aligned to it then hangs off the viewport
 * where it can be neither read nor tapped. This measures the open panel and
 * returns a `transform` that slides it back inside, re-measuring on resize.
 *
 * Attach `ref` to the panel and spread `style` onto it.
 *
 * @param {boolean} open  whether the panel is mounted
 * @returns {{ ref: import('react').RefObject<HTMLElement>, style: import('react').CSSProperties | undefined }}
 */
export function useViewportClamp(open) {
    const ref = useRef(/** @type {HTMLElement | null} */ (null));
    const [shift, setShift] = useState(0);
    const shiftRef = useRef(0);

    useLayoutEffect(() => {
        if (!open) {
            shiftRef.current = 0;
            setShift(0);
            return undefined;
        }
        const place = () => {
            const el = ref.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            // The rect includes the transform already applied; take it back
            // out so every pass measures the panel's natural position.
            const next = clampShift(
                rect.left - shiftRef.current,
                rect.width,
                document.documentElement.clientWidth,
            );
            if (next !== shiftRef.current) {
                shiftRef.current = next;
                setShift(next);
            }
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
    }, [open]);

    return { ref, style: shift ? { transform: `translateX(${shift}px)` } : undefined };
}
