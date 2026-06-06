// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import styles from './Screen.module.css';

const MAIN_ID = 'xc-main';

/**
 * Top-level layout wrapper.
 *
 *   `variant="small"` — narrow viewport, fixed 360×600 (Chrome
 *                        extension popup, mobile browser, narrow
 *                        desktop window).
 *   `variant="full"`  — wide viewport, flexible (extension full-screen
 *                        tab, desktop browser, tablet landscape).
 *
 * §53.2 / G168 — header / main / footer use the right semantic elements
 * so screen readers can navigate by landmark instead of having to walk
 * the entire DOM each screen.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.header]
 * @param {import('react').ReactNode} [props.footer]
 * @param {'small' | 'full'} [props.variant]
 * @param {import('react').ReactNode} props.children
 */
export function Screen({ header, footer, variant = 'small', children }) {
    const className = `${styles.screen} ${styles[variant]}`;
    return (
        <div className={className}>
            {header ? <header className={styles.header}>{header}</header> : null}
            <main id={MAIN_ID} tabIndex={-1} className={styles.body}>
                {children}
            </main>
            {footer ? <footer className={styles.footer}>{footer}</footer> : null}
        </div>
    );
}
