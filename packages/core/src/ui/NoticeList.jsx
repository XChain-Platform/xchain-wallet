// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import styles from './NoticeList.module.css';

/**
 * @typedef {object} NoticeListItem
 * @property {string | number} key
 * @property {import('react').ReactNode} content
 * @property {Record<string, string | undefined>} [attrs]  data-* or aria attributes for the item's element (a test hook, `data-error-for`)
 * @property {string} [className]                         layout class for the item's element
 */

/**
 * The issues a notice lists (U101, 2026-11-21): when a notice names more
 * than one problem (the checks the network could not verify, a form's
 * errors, a decoder's warnings), each one is its own bullet in a bulleted
 * list inside the notice, never a stack of plain lines. A single issue stays
 * a plain line with no bullet, and an empty list renders nothing.
 *
 * The bullets sit inside the notice's text column, so the first bullet
 * lines up with the title above it and the item text wraps under itself.
 *
 * @param {object} props
 * @param {ReadonlyArray<NoticeListItem>} props.items
 * @param {string} [props.label]   accessible name of the list (several items only)
 * @param {string} [props.testId]  data-testid on the list or the single line
 * @param {boolean} [props.forceList] render one item as a bullet when the notice requires a list
 */
export function NoticeList({ items, label, testId, forceList = false }) {
    const shown = (items || []).filter((item) => item && item.content !== null && item.content !== undefined && item.content !== false && item.content !== '');
    if (shown.length === 0) return null;
    if (shown.length === 1 && !forceList) {
        const [only] = shown;
        // A block, not a paragraph: an issue may hold a block of its own (a
        // diagnostic that links to its code line).
        return (
            <div {...only.attrs} className={only.className} data-testid={only.attrs?.['data-testid'] ?? testId} data-notice-issue="">
                {only.content}
            </div>
        );
    }
    return (
        <ul className={styles.list} aria-label={label || undefined} data-testid={testId} data-notice-list="">
            {shown.map((item) => (
                <li key={item.key} {...item.attrs} className={item.className}>
                    {item.content}
                </li>
            ))}
        </ul>
    );
}
