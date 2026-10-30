// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import styles from './ListPage.module.css';

/**
 * Page template for every screen whose job is to show things: a list, a
 * table, a grid of cards, or a detail view made of read-only rows. The
 * content fills Screen's content box at every layout tier. Screen owns the
 * responsive page gutter and reserves the scrollbar gutter, so route
 * modules do not add page-edge spacing or width constraints.
 *
 * The toolbar slot holds search, filter and sort controls. Its first item
 * takes the spare room; the rest keep their natural width and wrap onto a
 * new line on a narrow screen. Give a search input `type="search"`.
 *
 * Use EmptyState as the content when there is nothing to list, and
 * SectionHeader to title groups within the list.
 *
 * The page header holds only the title and Back, so a screen's own actions
 * (create, refresh, open a related screen) go in the actions row. The page
 * lays out its parts in one fixed order: notices first, then the actions
 * row, then the intro, the toolbar and the content. When the list is empty
 * and its EmptyState offers the same create action, leave that action out
 * of the actions row so the screen never shows it twice.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.notices]   status messages about this screen, shown first
 * @param {import('react').ReactNode} [props.actions]   buttons for the screen's own actions
 * @param {import('react').ReactNode} [props.toolbar]   search / filter / sort row above the content
 * @param {import('react').ReactNode} [props.intro]     one muted paragraph above the toolbar
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function ListPage({ notices, actions, toolbar, intro, className, children, ...rest }) {
    return (
        <div className={[styles.page, className].filter(Boolean).join(' ')} {...rest}>
            {notices || null}
            {actions ? <div className={styles.actions} data-xc-page-actions="">{actions}</div> : null}
            {intro ? <p className={styles.intro}>{intro}</p> : null}
            {toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
            {children}
        </div>
    );
}
