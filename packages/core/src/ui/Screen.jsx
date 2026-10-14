// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    createContext,
    useCallback,
    useContext,
    useLayoutEffect,
    useMemo,
    useRef,
} from 'react';
import { NoticesClaimedContext, ShellNoticesContext } from '../shared/components/noticesRoute.js';
import styles from './Screen.module.css';

const MAIN_ID = 'xc-main';
const FOCUS_REVEAL_MARGIN_PX = 12;
const ScrollRestorationContext = createContext(null);

/**
 * Keeps route scroll offsets for the lifetime of the unlocked shell.
 *
 * @param {object} props
 * @param {string} props.routeKey
 * @param {import('react').ReactNode} props.children
 */
export function ScrollRestoration({ routeKey, children }) {
    const positionsRef = useRef(new Map());
    const value = useMemo(
        () => ({ routeKey, positions: positionsRef.current }),
        [routeKey],
    );
    return (
        <ScrollRestorationContext.Provider value={value}>
            {children}
        </ScrollRestorationContext.Provider>
    );
}

/**
 * Top-level layout wrapper.
 *
 *   `variant="small"`: narrow viewport, fixed 360×600 (Chrome
 *                        extension popup, mobile browser, narrow
 *                        desktop window).
 *   `variant="full"`:  wide viewport, flexible (extension full-screen
 *                        tab, desktop browser, tablet landscape).
 *
 * §53.2 / G168: header / main / footer use the right semantic elements
 * so screen readers can navigate by landmark instead of having to walk
 * the entire DOM each screen.
 *
 * Inside the unlocked shell the outermost Screen also shows the shell's
 * notices (stale balances, queued broadcasts, update notices) as the first
 * thing in its scrolling body, below the page header: notices are page
 * content, never part of the app or page header.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.header]
 * @param {import('react').ReactNode} [props.footer]
 * @param {'small' | 'full'} [props.variant]
 * @param {'main' | 'section' | 'div'} [props.bodyAs]
 * @param {string} [props.bodyLabelledBy]
 * @param {import('react').RefObject<HTMLDivElement>} [props.rootRef]
 * @param {string} [props.scrollKey]   independently restored view within a route
 * @param {boolean} [props.restoreScroll]
 * @param {import('react').ReactNode} props.children
 */
export function Screen({
    header,
    footer,
    variant = 'small',
    bodyAs: Body = 'main',
    bodyLabelledBy,
    rootRef,
    scrollKey,
    restoreScroll = true,
    children,
}) {
    const screenRef = useRef(null);
    const mainRef = useRef(null);
    const restoration = useContext(ScrollRestorationContext);
    const shellNotices = useContext(ShellNoticesContext);
    const noticesClaimed = useContext(NoticesClaimedContext);
    const ownsNotices = Boolean(shellNotices) && !noticesClaimed;
    const noticesSlotRef = useRef(null);
    const routeKey = restoration?.routeKey;
    const positions = restoration?.positions;
    const positionKey = scrollKey == null ? routeKey : JSON.stringify([routeKey, scrollKey]);
    const setScreenRef = useCallback((node) => {
        screenRef.current = node;
        if (typeof rootRef === 'function') rootRef(node);
        else if (rootRef) rootRef.current = node;
    }, [rootRef]);

    useLayoutEffect(() => {
        const slot = noticesSlotRef.current;
        if (!ownsNotices || !slot) return undefined;
        return shellNotices.claim(slot);
    }, [ownsNotices, shellNotices]);

    useLayoutEffect(() => {
        const main = mainRef.current;
        if (!main) return undefined;
        if (!restoreScroll) {
            main.scrollTop = 0;
            return undefined;
        }
        if (positionKey == null || !positions) return undefined;
        main.scrollTop = positions.get(positionKey) ?? 0;
        return () => positions.set(positionKey, main.scrollTop);
    }, [positionKey, positions, restoreScroll]);

    useLayoutEffect(() => {
        // The visual viewport excludes the soft keyboard even when CSS viewport
        // units still describe the full layout viewport. Keep this Screen and
        // its footer inside that visible area, then reveal its focused control.
        const viewport = typeof window === 'undefined' ? null : window.visualViewport;
        const root = screenRef.current;
        if (!viewport || typeof viewport.addEventListener !== 'function' || !root) return undefined;
        let frame = null;

        const fitAndReveal = () => {
            if (frame != null) window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(() => {
                frame = null;
                const currentRoot = screenRef.current;
                const main = mainRef.current;
                if (!currentRoot || !main) return;

                currentRoot.style.removeProperty('--xc-screen-visible-height');
                const rootBox = currentRoot.getBoundingClientRect();
                const viewportBottom = viewport.offsetTop + viewport.height;
                if (rootBox.bottom > viewportBottom) {
                    const visibleHeight = Math.max(0, viewportBottom - rootBox.top);
                    currentRoot.style.setProperty('--xc-screen-visible-height', `${Math.floor(visibleHeight)}px`);
                }

                const active = currentRoot.ownerDocument.activeElement;
                if (!active || active === main || !main.contains(active)) return;
                const fieldBox = active.getBoundingClientRect();
                const mainBox = main.getBoundingClientRect();
                const visibleTop = Math.max(mainBox.top, viewport.offsetTop);
                const visibleBottom = Math.min(mainBox.bottom, viewportBottom);
                if (fieldBox.bottom > visibleBottom - FOCUS_REVEAL_MARGIN_PX) {
                    main.scrollTop += fieldBox.bottom - visibleBottom + FOCUS_REVEAL_MARGIN_PX;
                } else if (fieldBox.top < visibleTop + FOCUS_REVEAL_MARGIN_PX) {
                    main.scrollTop -= visibleTop - fieldBox.top + FOCUS_REVEAL_MARGIN_PX;
                }
            });
        };

        viewport.addEventListener('resize', fitAndReveal);
        return () => {
            viewport.removeEventListener('resize', fitAndReveal);
            if (frame != null) window.cancelAnimationFrame(frame);
            root.style.removeProperty('--xc-screen-visible-height');
        };
    }, []);

    const className = `${styles.screen} ${styles[variant]}`;
    const screen = (
        <div ref={setScreenRef} className={className}>
            {header ? <header className={styles.header}>{header}</header> : null}
            <Body
                ref={mainRef}
                id={Body === 'main' ? MAIN_ID : undefined}
                tabIndex={-1}
                className={styles.body}
                aria-labelledby={bodyLabelledBy}
            >
                {ownsNotices ? <div ref={noticesSlotRef} className={styles.notices} /> : null}
                {children}
            </Body>
            {footer ? <footer className={styles.footer}>{footer}</footer> : null}
        </div>
    );
    // A Screen nested in this one (a subpage, a picker) leaves the notices
    // here. Always wrapped, so a change of owner never remounts the route.
    return (
        <NoticesClaimedContext.Provider value={noticesClaimed || ownsNotices}>
            {screen}
        </NoticesClaimedContext.Provider>
    );
}
