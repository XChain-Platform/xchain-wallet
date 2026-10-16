// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useRouteIsNavDestination } from '../shared/components/navSurface.js';
import { useBackHandler } from './backStack.js';
import { Button } from './Button.jsx';
import { BackIcon } from './icons/index.jsx';
import styles from './PageHeader.module.css';
import { t } from '../i18n/index.js';

/**
 * Shared secondary-toolbar header used by every routed screen.
 *
 * The Back chevron is left out on a screen the visible navigation already
 * links to (a sidebar destination while the sidebar shows, a bottom-bar tab
 * while the tab bar shows); see NAV_SURFACE_DESTINATIONS in
 * routeRegistry.js. The system Back gesture still runs `onBack` there, and
 * the leading lane keeps its width so the title stays centred.
 *
 * Encapsulates the 3-column grid layout, chevron alignment (lines up
 * under the AppHeader logo via a negative margin-inline-start), title
 * centering, and an optional trailing-action slot. Every route should
 * use this rather than rolling its own `.header` / `.back` / `.title`
 * CSS (see STYLE_GUIDE.md).
 *
 * @param {object} props
 * @param {(() => void) | undefined} [props.onBack]   when present, renders a
 *   back chevron in the leading slot AND makes the system Back gesture (the
 *   Android Back key, the browser's Back button) run it. Omit to render an
 *   empty spacer.
 * @param {string} [props.backLabel]                  aria-label for the back
 *   button. Defaults to "Back to previous screen".
 * @param {boolean} [props.backDisabled]              disables the back button
 *   (e.g. while a submit is in flight). The chevron stays visible but inert.
 * @param {boolean} [props.nested]                    marks a sub-screen that
 *   shares its parent's route id (a Settings section, a Contacts detail, a
 *   review step). Such a screen always shows Back, even when the visible
 *   navigation links to the route itself.
 * @param {import('react').ReactNode} props.title     centered title text.
 * @param {string} [props.titleId]                    id for naming the screen body.
 * @param {import('react').Ref<HTMLHeadingElement>} [props.titleRef] ref for moving focus to the screen heading.
 * @param {import('react').ReactNode} [props.titleIcon]   optional inline icon
 *   placed immediately to the left of the title (e.g. a route-action glyph
 *   like Send / Receive).
 * @param {import('react').ReactNode} [props.trailing]    right-side slot for
 *   page-scoped actions (filter buttons, scan, etc.). Omit to render an
 *   empty spacer for symmetry.
 */
export function PageHeader({
    onBack,
    backLabel = t('ui.pageHeader.backToPreviousScreen'),
    backDisabled = false,
    nested = false,
    title,
    titleId,
    titleRef,
    titleIcon = null,
    trailing = null,
}) {
    useBackHandler(onBack, backDisabled, 'route');
    const reachableFromNav = useRouteIsNavDestination();
    const showBack = Boolean(onBack) && !(reachableFromNav && !nested);
    const accessibleBackLabel = backLabel.trim().toLowerCase() === 'back'
        ? 'Back to previous screen'
        : backLabel;
    return (
        <div className={styles.header}>
            {showBack ? (
                <Button
                    size="sm"
                    variant="secondary"
                    icon={<BackIcon />}
                    onClick={onBack}
                    aria-label={accessibleBackLabel}
                    disabled={backDisabled}
                />
            ) : (
                <span className={styles.spacer} />
            )}
            <span className={styles.titleGroup}>
                {/* The screen's title is its one top-level heading, so a
                    screen reader can jump to it and announce where the user is. */}
                <h1
                    ref={titleRef}
                    id={titleId}
                    className={styles.title}
                    title={typeof title === 'string' ? title : undefined}
                    tabIndex={titleRef ? -1 : undefined}
                >
                    {titleIcon ? (
                        <span className={styles.titleIcon} aria-hidden="true">
                            {titleIcon}
                        </span>
                    ) : null}
                    {title}
                </h1>
            </span>
            {trailing ? (
                <span className={styles.trailing}>{trailing}</span>
            ) : (
                <span className={styles.spacer} />
            )}
        </div>
    );
}
