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
 * content fills compact layouts and grows to a readable desktop ceiling.
 * There is no narrow/wide switch: a list is never boxed into the form
 * template's 560px column.
 *
 * The toolbar slot holds search, filter and sort controls. Its first item
 * takes the spare room; the rest keep their natural width and wrap onto a
 * new line on a narrow screen. Give a search input `type="search"`.
 *
 * Use EmptyState as the content when there is nothing to list, and
 * SectionHeader to title groups within the list.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.toolbar]   search / filter / sort row above the content
 * @param {import('react').ReactNode} [props.intro]     one muted paragraph above the toolbar
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function ListPage({ toolbar, intro, className, children, ...rest }) {
    return (
        <div className={[styles.page, className].filter(Boolean).join(' ')} {...rest}>
            {intro ? <p className={styles.intro}>{intro}</p> : null}
            {toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
            {children}
        </div>
    );
}
