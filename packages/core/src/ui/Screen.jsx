// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import styles from './Screen.module.css';

const MAIN_ID = 'xc-main';
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
    return (
        <ScrollRestorationContext.Provider value={{ routeKey, positions: positionsRef.current }}>
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
 * @param {object} props
 * @param {import('react').ReactNode} [props.header]
 * @param {import('react').ReactNode} [props.footer]
 * @param {'small' | 'full'} [props.variant]
 * @param {'main' | 'section' | 'div'} [props.bodyAs]
 * @param {string} [props.bodyLabelledBy]
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
    scrollKey,
    restoreScroll = true,
    children,
}) {
    const mainRef = useRef(null);
    const restoration = useContext(ScrollRestorationContext);
    const routeKey = restoration?.routeKey;
    const positions = restoration?.positions;
    const positionKey = scrollKey == null ? routeKey : JSON.stringify([routeKey, scrollKey]);

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

    const className = `${styles.screen} ${styles[variant]}`;
    return (
        <div className={className}>
            {header ? <header className={styles.header}>{header}</header> : null}
            <Body
                ref={mainRef}
                id={Body === 'main' ? MAIN_ID : undefined}
                tabIndex={-1}
                className={styles.body}
                aria-labelledby={bodyLabelledBy}
            >
                {children}
            </Body>
            {footer ? <footer className={styles.footer}>{footer}</footer> : null}
        </div>
    );
}
