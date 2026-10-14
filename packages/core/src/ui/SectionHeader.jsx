// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import styles from './SectionHeader.module.css';

/**
 * Titles one group of content inside a page: a run of list rows, a block of
 * cards, or a FormSection. Renders a real heading element so screen readers
 * can jump between groups, plus an optional one-line description and an
 * optional trailing action ("See all", a filter button).
 *
 * The page title lives in PageHeader, so the default level is h2; pass
 * `as="h3"` for a group nested under another SectionHeader.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.title
 * @param {'h2' | 'h3' | 'h4'} [props.as]                 heading level, default h2
 * @param {string} [props.id]                             id for the heading, so a region can point aria-labelledby at it
 * @param {import('react').ReactNode} [props.description] one muted line under the title
 * @param {import('react').ReactNode} [props.trailing]    right-side action; wraps under the title when there is no room
 * @param {string} [props.className]
 */
export function SectionHeader({ title, as: Tag = 'h2', id, description, trailing, className }) {
    return (
        <div
            className={[styles.header, className].filter(Boolean).join(' ')}
            data-xc-section-header=""
        >
            <div className={styles.text}>
                <Tag id={id} className={styles.title}>{title}</Tag>
                {description ? <p className={styles.description}>{description}</p> : null}
            </div>
            {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
        </div>
    );
}
