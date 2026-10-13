// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Button } from './Button.jsx';
import styles from './EmptyState.module.css';

/**
 * The one empty state the wallet uses: shown when data loaded fine and
 * there is nothing to list. Centred, full width of the content area:
 * optional icon, a title, one line of body, and an optional action that
 * helps fill the view ("Receive", "Create poll").
 *
 * It is a status region, so a screen reader announces it when a list
 * empties under the user (a filter that matches nothing).
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.title         short headline ("No payments due")
 * @param {import('react').ReactNode} [props.body]        one line on what would fill this view
 * @param {import('react').ReactNode} [props.icon]        decorative icon above the title
 * @param {string} [props.actionLabel]                    omit, with onAction, for no button
 * @param {() => void} [props.onAction]
 * @param {import('react').ReactNode | null} [props.actionIcon]   icon for the button; defaults to the label's icon
 * @param {'h2' | 'h3' | 'p'} [props.titleAs]             default h2; h3 under a SectionHeader
 * @param {string} [props.role]                           default 'status'
 * @param {string} [props.className]
 */
export function EmptyState({
    title,
    body,
    icon,
    actionLabel,
    onAction,
    actionIcon,
    titleAs: Title = 'h2',
    role = 'status',
    className,
}) {
    return (
        <div className={[styles.wrap, className].filter(Boolean).join(' ')} role={role}>
            {icon ? <div className={styles.icon} aria-hidden="true">{icon}</div> : null}
            <Title className={styles.title}>{title}</Title>
            {body ? <p className={styles.body}>{body}</p> : null}
            {actionLabel && onAction ? (
                <div className={styles.action}>
                    <Button variant="primary" size="sm" onClick={onAction} icon={actionIcon}>
                        {actionLabel}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
