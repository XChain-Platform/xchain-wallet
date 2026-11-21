// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A two-panel split whose start panel is resized by dragging the line
// between the panels, the DEX list's divider (MarketsList, operator
// 2026-11-13) lifted into one shared piece so wide Home and any later split
// behave the same: a 1px line with 13px of hit area that turns accent on
// hover, focus and drag; a focusable `separator` that Left and Right resize
// (Shift for four steps), Home and End send to the minimum and maximum, and
// Enter or a double-click returns to the default; and the width remembered
// on this device under one `xc:` key.

import { Suspense, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    readPanelSplitPreference,
    writePanelSplitPreference,
} from '../hooks/useSettingsRootAttributes.js';
import { useFoldDivision } from '../hooks/useFoldDivision.js';
import styles from './PanelSplit.module.css';

/** The line and the 8px on each side of it, between the two panels. */
export const PANEL_SPLIT_GUTTER_PX = 17;

/**
 * The list-and-detail split the DEX drew first (MarketsList, operator
 * 2026-11-13, layout 2), shared so every list that opens a detail splits the
 * same way. From LIST_DETAIL_MIN_WIDTH of content width (iPad 834 beside its
 * icon rail and wider) the list keeps 36% of the width, 272 to 400px, and
 * never so much that the detail drops under 420px; phones keep the list,
 * then the detail page.
 */
export const LIST_DETAIL_MIN_WIDTH = 720;
export const LIST_DETAIL_LIST_MIN_PX = 272;
export const LIST_DETAIL_LIST_MAX_PX = 400;
export const LIST_DETAIL_DETAIL_MIN_PX = 420;
export const LIST_DETAIL_LIST_SHARE = 0.36;

/**
 * Whether the element's own width reaches `minWidth`, measured before paint
 * and on every resize. The container decides, not the viewport, since the
 * side menu takes part of the window. An element with no width yet (or
 * jsdom, which has no layout) counts as narrow, the flow that works at every
 * width.
 *
 * The ref is a callback ref that also carries `.current`, so the measured box
 * may change element (a list that turns into its detail page and back, or a
 * lazily loaded page that mounts late) and the newest one is the one
 * observed. `measured` turns true once a box has been read, so a host that
 * must not mount either layout before it knows the width can wait for it.
 *
 * @param {number} minWidth
 * @param {boolean} enabled
 * @returns {[((el: HTMLElement | null) => void) & { current: HTMLElement | null }, boolean, boolean]}
 */
export function useWideContent(minWidth, enabled) {
    const [node, setNode] = useState(/** @type {HTMLElement | null} */ (null));
    const [wide, setWide] = useState(false);
    const [measured, setMeasured] = useState(false);
    const ref = useMemo(() => {
        /** @type {((el: HTMLElement | null) => void) & { current: HTMLElement | null }} */
        const attach = Object.assign((el) => {
            attach.current = el;
            // A box that leaves keeps the last reading until the next one mounts.
            if (el) setNode(el);
        }, { current: null });
        return attach;
    }, []);
    useLayoutEffect(() => {
        if (!enabled) {
            setWide(false);
            setMeasured(true);
            return undefined;
        }
        if (!node) return undefined;
        const measure = () => {
            const width = node.getBoundingClientRect?.().width || 0;
            const next = width >= minWidth;
            setWide((prev) => (prev === next ? prev : next));
            setMeasured(true);
        };
        measure();
        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(measure);
            observer.observe(node);
            return () => observer.disconnect();
        }
        if (typeof window === 'undefined') return undefined;
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [node, minWidth, enabled]);
    return [ref, wide, measured];
}

/**
 * The widest the start panel may be in a split this wide: `max`, less
 * whatever would leave the other panel under `minOther`, never under `min`.
 * An unmeasured split (0, jsdom) applies only `max`.
 *
 * @param {{ min: number, max: number, minOther?: number }} limits
 * @param {number} layoutWidth
 */
export function panelSplitMax({ min, max, minOther = 0 }, layoutWidth) {
    if (!Number.isFinite(layoutWidth) || layoutWidth <= 0) return max;
    const room = layoutWidth - minOther - PANEL_SPLIT_GUTTER_PX;
    return Math.max(min, Math.min(max, Math.floor(room)));
}

/**
 * Clamp a width to the split's range for a split this wide, whole pixels.
 *
 * @param {number} px
 * @param {{ min: number, max: number, minOther?: number }} limits
 * @param {number} [layoutWidth]
 */
export function clampPanelSplit(px, limits, layoutWidth = 0) {
    const value = Number(px);
    const top = panelSplitMax(limits, layoutWidth);
    if (!Number.isFinite(value)) return limits.min;
    return Math.round(Math.min(top, Math.max(limits.min, value)));
}

function readStoredWidth(storageKey, limits) {
    if (!storageKey) return null;
    const value = readPanelSplitPreference(storageKey);
    return value === null ? null : clampPanelSplit(value, limits);
}

function writeStoredWidth(storageKey, px) {
    writePanelSplitPreference(storageKey, px);
}

function inlineSign(el) {
    try {
        return el && globalThis.getComputedStyle?.(el).direction === 'rtl' ? -1 : 1;
    } catch {
        return 1;
    }
}

function foldPanelWidth(fold, box, el) {
    if (!fold.vertical || !Number.isFinite(fold.dividerX) || box.width <= 0) return null;
    const start = inlineSign(el) < 0
        ? box.right - fold.dividerX
        : fold.dividerX - box.left;
    if (start <= 0 || start >= box.width) return null;
    const halfGutter = (PANEL_SPLIT_GUTTER_PX - 1) / 2;
    const available = Math.max(0, box.width - PANEL_SPLIT_GUTTER_PX);
    return Math.round(Math.min(available, Math.max(0, start - halfGutter)));
}

/**
 * The split's state: the start panel's width (dragged and saved, or the
 * default share of the measured split), the measured split itself, and the
 * divider's handlers.
 *
 * @param {object} options
 * @param {string} [options.storageKey]   the page key in `xc:displayPrefs.panelSplits`
 * @param {number} options.min            the start panel's narrowest width
 * @param {number} options.max            its widest
 * @param {number} [options.minOther]     the other panel's narrowest width
 * @param {number} [options.defaultShare] the default width as a share of the split (0..1)
 * @param {number} [options.step]         one arrow-key step in px; Shift takes four
 */
export function usePanelSplit({ storageKey, min, max, minOther = 0, defaultShare = 0.4, step = 8 }) {
    const limits = { min, max, minOther };
    const layoutRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const [layoutBox, setLayoutBox] = useState({ width: 0, left: 0, right: 0 });
    const [saved, setSaved] = useState(() => readStoredWidth(storageKey, limits));
    const [dragging, setDragging] = useState(false);
    const fold = useFoldDivision();

    useLayoutEffect(() => {
        setSaved(readStoredWidth(storageKey, { min, max, minOther }));
    }, [storageKey, min, max, minOther]);

    useLayoutEffect(() => {
        const el = layoutRef.current;
        if (!el) return undefined;
        const measure = () => {
            const rect = el.getBoundingClientRect?.();
            const width = Math.round(rect?.width || 0);
            const left = Number.isFinite(rect?.left) ? rect.left : 0;
            const right = Number.isFinite(rect?.right) ? rect.right : left + width;
            setLayoutBox((prev) => (
                prev.width === width && prev.left === left && prev.right === right
                    ? prev
                    : { width, left, right }
            ));
        };
        measure();
        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(measure);
            observer.observe(el);
            return () => observer.disconnect();
        }
        if (typeof window === 'undefined') return undefined;
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [fold.dividerX, fold.vertical]);

    const layoutWidth = layoutBox.width;
    const defaultWidth = clampPanelSplit(
        layoutWidth > 0 ? layoutWidth * defaultShare : min,
        limits,
        layoutWidth,
    );
    const preferredWidth = saved === null
        ? defaultWidth
        : clampPanelSplit(saved, limits, layoutWidth);
    const snappedWidth = foldPanelWidth(fold, layoutBox, layoutRef.current);
    const width = snappedWidth ?? preferredWidth;
    const widest = panelSplitMax(limits, layoutWidth);

    const save = useCallback((px) => {
        const next = px === null ? null : clampPanelSplit(px, { min, max, minOther }, layoutRef.current?.getBoundingClientRect?.().width || 0);
        setSaved(next);
        writeStoredWidth(storageKey, next);
    }, [storageKey, min, max, minOther]);

    const onPointerDown = (event) => {
        if (event.button) return;
        event.preventDefault();
        const sign = inlineSign(event.currentTarget);
        const startX = event.clientX;
        const start = width;
        const measured = layoutRef.current?.getBoundingClientRect?.().width || 0;
        let last = start;
        setDragging(true);
        const move = (e) => {
            last = clampPanelSplit(start + (e.clientX - startX) * sign, limits, measured);
            setSaved(last);
        };
        // On the window, so a pointer that outruns the line keeps resizing.
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            setDragging(false);
            save(last);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
    };

    const onKeyDown = (event) => {
        const towardWider = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        let next;
        if (towardWider) next = width + step * (event.shiftKey ? 4 : 1) * towardWider * inlineSign(event.currentTarget);
        else if (event.key === 'Home') next = min;
        else if (event.key === 'End') next = widest;
        else if (event.key === 'Enter') next = null;
        else return;
        event.preventDefault();
        save(next);
    };

    return {
        layoutRef,
        layoutWidth,
        width,
        min: Math.min(min, width),
        max: Math.max(widest, width),
        dragging,
        onPointerDown,
        onKeyDown,
        onReset: () => save(null),
    };
}

/**
 * The line between the two panels: drawn, dragged and keyboard-resized.
 *
 * @param {object} props
 * @param {ReturnType<typeof usePanelSplit>} props.split
 * @param {string} props.label      the separator's accessible name
 * @param {string} [props.hint]     the tooltip (how to resize)
 * @param {string} [props.controls] the id of the panel it resizes
 * @param {string} [props.className]
 */
export function PanelSplitDivider({ split, label, hint, controls, className }) {
    return (
        <div
            role="separator"
            tabIndex={0}
            className={className ? `${styles.divider} ${className}` : styles.divider}
            aria-orientation="vertical"
            aria-label={label}
            aria-controls={controls}
            aria-valuemin={split.min}
            aria-valuemax={split.max}
            aria-valuenow={split.width}
            title={hint}
            data-dragging={split.dragging ? '' : undefined}
            onPointerDown={split.onPointerDown}
            onKeyDown={split.onKeyDown}
            onDoubleClick={split.onReset}
        />
    );
}

/**
 * The list-and-detail split's two panels, the DEX's (MarketsList) layout for
 * any other list: the list column on the start side at the DEX's widths, the
 * line between that drags and arrow-keys it, and the picked item's detail in
 * the rest. Each panel scrolls on its own and is a column of its own cards,
 * never a card around them (U16). The host puts `listDetailStyles.twoPanelBody`
 * on its Screen body so the line runs from the header to the bottom edge.
 *
 * @param {object} props
 * @param {(el: HTMLElement | null) => void} [props.measureRef] the host's
 *   useWideContent ref, so the split box stays the measured box
 * @param {string} props.storageKey  where the dragged list width is kept on this device
 * @param {string} props.resizeLabel the line's accessible name ("Resize the staking list")
 * @param {string} [props.resizeHint] the line's tooltip
 * @param {string} props.layoutName  the split box's data-list-detail value, for tests and the wall
 * @param {import('react').ReactNode} [props.listHeader] content that stays above the list scroller
 * @param {import('react').ReactNode} props.list
 * @param {string} props.listLabel   the list region's accessible name
 * @param {import('react').ReactNode} props.detail
 * @param {string} props.detailLabel the detail region's accessible name
 * @param {boolean} [props.detailBusy]
 * @param {import('react').ReactNode} [props.detailFallback] shown while a lazily loaded detail loads
 * @param {number} [props.listMax] optional page-specific maximum for the list panel
 */
export function ListDetailSplit({
    measureRef,
    storageKey,
    resizeLabel,
    resizeHint,
    layoutName,
    listHeader = null,
    list,
    listLabel,
    detail,
    detailLabel,
    detailBusy = false,
    detailFallback = null,
    listMax = LIST_DETAIL_LIST_MAX_PX,
}) {
    const listId = useId();
    const split = usePanelSplit({
        storageKey,
        min: LIST_DETAIL_LIST_MIN_PX,
        max: listMax,
        minOther: LIST_DETAIL_DETAIL_MIN_PX,
        defaultShare: LIST_DETAIL_LIST_SHARE,
    });
    const { layoutRef } = split;
    const setBox = useCallback((el) => {
        layoutRef.current = el;
        measureRef?.(el);
    }, [layoutRef, measureRef]);
    return (
        <div ref={setBox} className={styles.twoPanel} data-list-detail={layoutName}>
            <div
                className={styles.listPanel}
                style={{ flexBasis: `${split.width}px` }}
            >
                {listHeader ? <div className={styles.listHeader}>{listHeader}</div> : null}
                {/* Only the rows scroll. The header slot above stays in place,
                    and the named list scroller remains keyboard reachable. */}
                <div
                    id={listId}
                    className={styles.listBody}
                    role="region"
                    aria-label={listLabel}
                    tabIndex={0}
                >
                    {list}
                </div>
            </div>
            <PanelSplitDivider split={split} label={resizeLabel} hint={resizeHint} controls={listId} />
            <div
                className={styles.detailPanel}
                role="region"
                aria-label={detailLabel}
                aria-busy={detailBusy || undefined}
                tabIndex={0}
            >
                {/* Its own Suspense: a shell's lazily loaded detail fills this
                    panel, never blanks the list beside it. */}
                <Suspense fallback={detailFallback}>{detail}</Suspense>
            </div>
        </div>
    );
}

/**
 * The split's class names, for a host's Screen body and its list's selected
 * row. `twoPanelBody` goes on the Screen body of a split that is the body's
 * only block; `splitBody` on the body of one that follows other blocks, with
 * `splitFill` on every box between that body and the split (G128).
 */
export const listDetailStyles = {
    layoutRoot: styles.layoutRoot,
    twoPanelBody: styles.twoPanelBody,
    splitBody: styles.splitBody,
    splitFill: styles.splitFill,
    listHeader: styles.listHeader,
    listBody: styles.listBody,
    selectedRow: styles.selectedRow,
};
