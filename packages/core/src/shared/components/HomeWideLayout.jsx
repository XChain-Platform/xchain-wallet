// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Wide Home (G115, the operator's layout 3 with layout 2's allocation,
// 2026-11-14): a top section holding the wallet value card (blue, with its
// chart) beside the allocation donut, with no heading of its own; then a
// divider running edge to edge across the content area, with the side menu's
// collapse handle (CollapseHandle) hanging under it, centred along it, that
// collapses the top section to nothing and expands it (operator 2026-11-15;
// a 120ms ease-out that only runs once the first frame has painted,
// remembered on this device); then the balances
// list and the selected item's detail side by side, split by a line that
// drags and arrow-keys the list's width (PanelSplit) and runs from the
// divider to the bottom of the content area.
//
// Desktop windows only: the layout is chosen from Home's own measured width
// (HOME_WIDE_MIN_PX), so phones, the extension popup, the side panel and the
// iPad keep the one-column Home exactly as it was.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { CollapseHandle } from './CollapseHandle.jsx';
import { PanelSplitDivider, usePanelSplit } from './PanelSplit.jsx';
import { useFoldDivision } from '../hooks/useFoldDivision.js';
import { useHomeTopCollapsed } from '../hooks/useHomeTopCollapsed.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/home.js';
import styles from './HomeWideLayout.module.css';

/**
 * Home's content width from which the wide layout shows. A 1280 window with
 * the side menu at its default width leaves Home about 1,107px (measured
 * 2026-11-14); the iPad's 834, and its 1194 landscape (about 1,020px beside
 * the menu), stay one column.
 */
export const HOME_WIDE_MIN_PX = 1060;
export const HOME_DUO_BOOK_FALLBACK_PX = 951;
// The Book measurement is unavailable because simctl io screenConfig crashes
// SpringBoard on this simulator runtime.
export const HOME_DUO_BOOK_WIDTH_PX = HOME_DUO_BOOK_FALLBACK_PX;

export function isHomeDuoBookSplit(viewportWidth, foldDivision) {
    return viewportWidth === HOME_DUO_BOOK_WIDTH_PX
        && foldDivision.vertical
        && Number.isFinite(foldDivision.dividerX);
}

/**
 * The balances list's width range beside the detail (operator 2026-11-14).
 * The minimum is what the five tabs (All, Coins, Tokens, NFTs, DeFi) and the
 * filter button need side by side, so the tab row never overflows.
 */
export const HOME_LIST_MIN_PX = 440;
export const HOME_LIST_MAX_PX = 720;
/** The detail never gets narrower than this because of a wide list. */
export const HOME_DETAIL_MIN_PX = 420;
export const HOME_LIST_WIDTH_KEY = 'home';

/**
 * Whether the element's own width reaches `minWidth`, measured before paint
 * and on every resize (the DEX's useWideContent rule: the container decides,
 * not the viewport). An element with no width yet (jsdom has no layout)
 * counts as narrow, the flow that works at every width.
 *
 * @param {number} minWidth
 * @param {boolean} enabled
 * @returns {[import('react').MutableRefObject<HTMLDivElement | null>, boolean]}
 */
export function useHomeWide(minWidth, enabled) {
    const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
    const [wide, setWide] = useState(false);
    const foldDivision = useFoldDivision();
    useLayoutEffect(() => {
        const el = ref.current;
        if (!enabled || !el) {
            setWide(false);
            return undefined;
        }
        const measure = () => {
            const width = el.getBoundingClientRect?.().width || 0;
            const divided = isHomeDuoBookSplit(globalThis.innerWidth, foldDivision);
            const next = width >= minWidth || divided;
            setWide((prev) => (prev === next ? prev : next));
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
    }, [minWidth, enabled, foldDivision.vertical, foldDivision.dividerX]);
    return [ref, wide];
}

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.hero        the wallet value card with its chart
 * @param {import('react').ReactNode} props.allocation  the allocation card
 * @param {import('react').ReactNode} props.listHeader  the tabs and filter that stay above the scroller
 * @param {import('react').ReactNode} props.list        the chosen tab's scrolling list
 * @param {import('react').ReactNode} props.detail      the selected item's detail
 * @param {string} [props.detailLabel]                  the detail region's name (the item's name)
 */
export function HomeWideLayout({ hero, allocation, listHeader, list, detail, detailLabel }) {
    const baseId = useId();
    const topId = `${baseId}-top`;
    const listId = `${baseId}-list`;
    const { collapsed, toggle } = useHomeTopCollapsed();
    // Motion only once the saved state has painted, so a reload never
    // animates into it (the side menu's rule).
    const [motion, setMotion] = useState(false);
    useEffect(() => {
        if (typeof requestAnimationFrame !== 'function') return undefined;
        const id = requestAnimationFrame(() => setMotion(true));
        return () => cancelAnimationFrame?.(id);
    }, []);
    const split = usePanelSplit({
        storageKey: 'home',
        min: HOME_LIST_MIN_PX,
        max: HOME_LIST_MAX_PX,
        minOther: HOME_DETAIL_MIN_PX,
        defaultShare: 0.4,
    });
    const toggleLabel = collapsed ? t('home.wide.showOverview') : t('home.wide.hideOverview');
    // A collapsed body stays mounted (the chart keeps its range) but leaves
    // the tab order and the accessibility tree.
    const hiddenProps = collapsed ? { inert: '', 'aria-hidden': 'true' } : {};

    return (
        <div
            className={styles.wide}
            data-home-layout="wide"
            data-top-collapsed={collapsed ? 'true' : 'false'}
            data-motion={motion ? 'on' : undefined}
        >
            {/* No heading (operator 2026-11-15): the section is named for
                assistive tech only, and the handle on the divider below is
                its one control. */}
            <section
                className={styles.top}
                data-collapsed={collapsed ? 'true' : 'false'}
                data-motion={motion ? 'on' : undefined}
                aria-label={t('home.wide.overview')}
            >
                <div id={topId} className={styles.topBody} {...hiddenProps}>
                    <div className={styles.topClip}>
                        <div className={styles.topRow}>
                            <div className={styles.heroCell}>{hero}</div>
                            <div className={styles.allocationCell}>{allocation}</div>
                        </div>
                    </div>
                </div>
            </section>
            {/* The expanded divider is decoration. Its handle stays reachable
                when the collapsed divider itself has no size or paint. */}
            <div
                className={styles.sectionDivider}
                data-home-divider=""
                data-collapsed={collapsed ? 'true' : 'false'}
            >
                <CollapseHandle
                    orientation="horizontal"
                    collapsed={collapsed}
                    className={styles.topHandle}
                    aria-controls={topId}
                    aria-label={toggleLabel}
                    title={toggleLabel}
                    onClick={toggle}
                />
            </div>
            {/* The split fills the room under the divider and each panel is
                its own named scroll region the keyboard can reach (G128); the
                list keeps its scroll position while the detail changes. */}
            <div
                ref={split.layoutRef}
                className={styles.split}
                data-dragging={split.dragging ? '' : undefined}
            >
                <div
                    className={styles.listPanel}
                    style={{ flexBasis: `${split.width}px` }}
                >
                    <div className={styles.listHeader}>{listHeader}</div>
                    <div
                        id={listId}
                        className={styles.listBody}
                        role="region"
                        aria-label={t('home.wide.list')}
                        tabIndex={0}
                    >
                        {list}
                    </div>
                </div>
                <PanelSplitDivider
                    split={split}
                    label={t('home.wide.resizeList')}
                    hint={t('home.wide.resizeListHint')}
                    controls={listId}
                />
                <div
                    className={styles.detailPanel}
                    role="region"
                    aria-label={detailLabel || t('home.wide.detail')}
                    data-home-detail=""
                    tabIndex={0}
                >
                    {detail}
                </div>
            </div>
        </div>
    );
}
