// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A padded card of plain explanation lines, taken from the license screen.
// A line that protects the user's money is a danger Notice (the Notice
// Standard, 2026-11-15): WarningLine critical renders one, so an untouched
// call site shows the standard red notice. New code puts a danger Notice on
// its own, outside any card, and keeps WarningCard for plain lines only.
// BodyParagraph is the same start-aligned line at body size for explanation
// pages outside a card.

import { Notice } from '../../ui/StatusMessage.jsx';
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
 * One line of a warning. `critical` draws it as a static danger Notice (no
 * live region: it is part of the page from the first paint); a plain line is
 * a paragraph.
 *
 * @param {object} props
 * @param {boolean} [props.critical]
 * @param {boolean} [props.edge]  false drops the notice's own margin, for a container whose gap spaces it (critical only)
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function WarningLine({ critical = false, edge = true, className, children, ...rest }) {
    if (critical) {
        return (
            <Notice
                {...rest}
                tone="danger"
                role="note"
                flush={!edge}
                className={className}
                data-warning-line="critical"
            >
                {children}
            </Notice>
        );
    }
    return (
        <p
            className={join(styles.paragraph, className)}
            data-warning-line="plain"
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
