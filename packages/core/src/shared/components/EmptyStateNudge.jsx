// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { EmptyState } from '../../ui/EmptyState.jsx';

/**
 * @param {object} props
 * @param {string} props.title                       short headline ("No balances yet")
 * @param {string} [props.body]                      one short sentence explaining what would populate this view
 * @param {string} [props.actionLabel]               omit + onAction to skip the button
 * @param {() => void} [props.onAction]
 * @param {import('react').ReactNode} [props.icon]   leading icon for the action button
 * @param {string} [props.role]                      optional role when the parent does not own announcements
 */
export function EmptyStateNudge({
    title,
    body,
    actionLabel,
    onAction,
    icon,
    role,
}) {
    const hasAction = actionLabel && onAction;

    return (
        <EmptyState
            title={title}
            body={body}
            actionLabel={hasAction ? actionLabel : undefined}
            onAction={hasAction ? onAction : undefined}
            actionIcon={icon}
            role={role ?? null}
        />
    );
}
