// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// EmptyStateNudge (§27.7 / §27.8 / §28 / G077). Replaces bare
// "No X yet" text placeholders with a content-shaped empty state that
// includes an optional primary action button. Used by Balance, History,
// and AddressList when the underlying dataset is empty.
//
// Optional `actionLabel` + `onAction` render a primary button (typically
// the Receive CTA) so the user has a one-tap nudge toward populating
// the view.

import { Button } from '@xchain-wallet/core/ui';
import styles from './EmptyStateNudge.module.css';

/**
 * @param {object} props
 * @param {string} props.title                       short headline ("No balances yet")
 * @param {string} [props.body]                      one or two sentences explaining what would populate this view
 * @param {string} [props.actionLabel]               omit + onAction to skip the button
 * @param {() => void} [props.onAction]
 * @param {import('react').ReactNode} [props.icon]   leading icon for the action button
 * @param {string} [props.role]                      defaults to 'status' so screen readers announce empty results
 */
export function EmptyStateNudge({
    title,
    body,
    actionLabel,
    onAction,
    icon,
    role = 'status',
}) {
    return (
        <div className={styles.wrap} role={role}>
            <div className={styles.title}>{title}</div>
            {body ? <p className={styles.body}>{body}</p> : null}
            {actionLabel && onAction ? (
                <div className={styles.actions}>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={onAction}
                        icon={icon}
                    >
                        {actionLabel}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
