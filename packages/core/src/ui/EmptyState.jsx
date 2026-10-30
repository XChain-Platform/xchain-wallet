// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useContext, useLayoutEffect } from 'react';
import { ShellReachabilityNoticeContext } from '../shared/components/noticesRoute.js';
import { Button } from './Button.jsx';
import { EmptyStateAsLineContext, EmptyStateCountContext, EmptyStateRegistryContext } from './Screen.jsx';
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
 * While the shell says the network could not be reached, an empty list is
 * not known to be empty, only unavailable, so the empty state steps aside and
 * the shell's notice is the page's one message; its actions stay. An empty
 * state that is not about network data (a missing page), or that states the
 * outage itself, passes `showWhileUnavailable`.
 *
 * A page shows one empty state. When a Screen holds two or more (a list per
 * section, all of them empty), each is drawn as a plain line of its title and
 * actions under its section header, and none is a page message. Inside a
 * form body it is always such a line, with its body: it describes one
 * field's choices.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.title         short headline ("No payments due")
 * @param {import('react').ReactNode} [props.body]        one line on what would fill this view
 * @param {import('react').ReactNode} [props.icon]        decorative icon above the title
 * @param {string} [props.actionLabel]                    omit, with onAction, for no button
 * @param {() => void} [props.onAction]
 * @param {import('react').ReactNode | null} [props.actionIcon]   icon for the button; defaults to the label's icon
 * @param {string} [props.secondaryActionLabel]           optional outline action shown after the primary action
 * @param {() => void} [props.onSecondaryAction]
 * @param {import('react').ReactNode | null} [props.secondaryActionIcon]
 * @param {boolean} [props.plain]                        accepted for older callers; every empty state is now unboxed
 * @param {'h1' | 'h2' | 'h3' | 'p'} [props.titleAs]       default h2; h3 under a SectionHeader; h1 when the empty state is the whole page
 * @param {string} [props.role]                           default 'status'
 * @param {boolean} [props.showWhileUnavailable]         stays while the shell's reachability notice is up
 * @param {string} [props.className]
 */
export function EmptyState({
    title,
    body,
    icon,
    actionLabel,
    onAction,
    actionIcon,
    secondaryActionLabel,
    onSecondaryAction,
    secondaryActionIcon,
    // Every empty state is unboxed now; the prop is taken off so it never
    // reaches the DOM through rest.
    plain: _plain,
    titleAs: Title = 'h2',
    role = 'status',
    className,
    showWhileUnavailable = false,
    ...rest
}) {
    const shellNotice = useContext(ShellReachabilityNoticeContext);
    const hidden = Boolean(shellNotice) && !showWhileUnavailable;
    const register = useContext(EmptyStateRegistryContext);
    const pageEmptyStates = useContext(EmptyStateCountContext);
    const inForm = useContext(EmptyStateAsLineContext);
    useLayoutEffect(() => (register && !hidden && !inForm ? register() : undefined), [register, hidden, inForm]);
    const hasPrimaryAction = Boolean(actionLabel && onAction);
    const hasSecondaryAction = Boolean(secondaryActionLabel && onSecondaryAction);
    if (hidden) {
        // The message steps aside, but a way forward it offered ("New
        // message", "Receive") stays on the page.
        return hasPrimaryAction || hasSecondaryAction ? (
            <div className={[styles.sectionActions, className].filter(Boolean).join(' ')}>
                {hasPrimaryAction ? (
                    <Button variant="primary" size="sm" onClick={onAction} icon={actionIcon}>
                        {actionLabel}
                    </Button>
                ) : null}
                {hasSecondaryAction ? (
                    <Button variant="secondary" size="sm" onClick={onSecondaryAction} icon={secondaryActionIcon}>
                        {secondaryActionLabel}
                    </Button>
                ) : null}
            </div>
        ) : null;
    }
    const sectionLine = inForm || pageEmptyStates > 1;

    return (
        <div
            className={[sectionLine ? styles.sectionLine : styles.wrap, className].filter(Boolean).join(' ')}
            role={role}
            // Marks the page message, which a route shows at most one of per
            // state (test/unit/ui/pageMessages.test.jsx counts them).
            data-empty-state={sectionLine ? undefined : ''}
            // Marks every empty state, page message or section line, so a
            // layout check can tell it from a notice: it stands where its
            // list would be, not first on the page.
            data-xc-empty-state=""
            {...rest}
        >
            {icon && !sectionLine ? <div className={styles.icon} aria-hidden="true">{icon}</div> : null}
            <Title className={sectionLine ? styles.sectionTitle : styles.title}>{title}</Title>
            {/* A line in a form keeps its body ("Generate an address to start
                receiving"); lines for several sections drop the help text. */}
            {body && (!sectionLine || inForm) ? <p className={sectionLine ? styles.sectionBody : styles.body}>{body}</p> : null}
            {hasPrimaryAction || hasSecondaryAction ? (
                <div className={sectionLine ? styles.sectionActions : styles.actions}>
                    {hasPrimaryAction ? (
                        <Button variant="primary" size="sm" onClick={onAction} icon={actionIcon}>
                            {actionLabel}
                        </Button>
                    ) : null}
                    {hasSecondaryAction ? (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={onSecondaryAction}
                            icon={secondaryActionIcon}
                        >
                            {secondaryActionLabel}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
