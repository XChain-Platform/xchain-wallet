// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { ChevronDownIcon } from './icons/index.jsx';
import styles from './ListRow.module.css';

/**
 * A full-width list item with native interaction semantics. An href renders
 * an anchor, an onClick handler renders a button, and a display-only row
 * renders a div. The surrounding page or list owns the page gutter.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.leading]
 * @param {import('react').ReactNode} props.title
 * @param {import('react').ReactNode} [props.subtitle]
 * @param {import('react').ReactNode} [props.trailing]
 * @param {import('react').ReactNode | boolean} [props.chevron]
 * @param {string} [props.href]
 * @param {(event: import('react').MouseEvent<HTMLButtonElement>) => void} [props.onClick]
 * @param {'button' | 'submit' | 'reset'} [props.type]
 * @param {string} [props.className]
 */
export function ListRow({
    leading,
    title,
    subtitle,
    trailing,
    chevron = false,
    href,
    onClick,
    type = 'button',
    className,
    ...rest
}) {
    const isLink = href != null;
    const isButton = !isLink && typeof onClick === 'function';
    const Component = isLink ? 'a' : isButton ? 'button' : 'div';
    const componentProps = isLink
        ? { href, onClick }
        : isButton ? { type, onClick } : {};
    const resolvedChevron = chevron === true ? <ChevronDownIcon /> : chevron;

    return (
        <Component
            className={[
                styles.row,
                isLink || isButton ? styles.interactive : null,
                className,
            ].filter(Boolean).join(' ')}
            {...componentProps}
            {...rest}
        >
            {leading ? <span className={styles.leading}>{leading}</span> : null}
            <span className={styles.content}>
                <span className={styles.title}>{title}</span>
                {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
            </span>
            {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
            {resolvedChevron ? (
                <span
                    className={[
                        styles.chevron,
                        chevron === true ? styles.defaultChevron : null,
                    ].filter(Boolean).join(' ')}
                    aria-hidden="true"
                >
                    {resolvedChevron}
                </span>
            ) : null}
        </Component>
    );
}
