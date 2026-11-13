// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wallet's one look for a security warning, taken from the license
// screen: a padded card of plain lines, with the lines that protect the
// user's money as red-edged callouts. Security warnings use it so they all
// read alike; the license terms compose the same line styles. BodyParagraph
// is the same start-aligned line at body size for explanation pages outside
// a card.

import styles from './WarningCard.module.css';

const join = (...names) => names.filter(Boolean).join(' ');

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.children  WarningLine rows
 * @param {string} [props.className]
 */
export function WarningCard({ children, className, ...rest }) {
    return (
        <div className={join(styles.card, className)} {...rest}>
            {children}
        </div>
    );
}

/**
 * One line of a warning. `critical` draws it as a red-edged callout.
 *
 * @param {object} props
 * @param {boolean} [props.critical]
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function WarningLine({ critical = false, className, children, ...rest }) {
    return (
        <p
            className={join(critical ? styles.critical : styles.paragraph, className)}
            data-warning-line={critical ? 'critical' : 'plain'}
            {...rest}
        >
            {children}
        </p>
    );
}

/**
 * An explanation page's paragraph: body size, start-aligned, full contrast.
 *
 * @param {object} props
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function BodyParagraph({ className, children, ...rest }) {
    return (
        <p className={join(styles.body, className)} {...rest}>
            {children}
        </p>
    );
}
