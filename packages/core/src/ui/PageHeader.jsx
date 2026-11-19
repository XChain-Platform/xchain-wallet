// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useContext, useEffect, useRef } from 'react';
import { useBackHandler } from './backStack.js';
import { Button } from './Button.jsx';
import { BackIcon } from './icons/index.jsx';
import { NavHistoryContext } from './navHistory.js';
import styles from './PageHeader.module.css';
import { t } from '../i18n/index.js';

/**
 * Shared secondary-toolbar header used by every routed screen.
 *
 * The Back chevron follows the shell's one navigation history (G06): it
 * shows whenever the page on screen was opened from another page, and is
 * left out on a root page, one opened from the sidebar, the bottom bar, the
 * menu or the command palette, since there is nothing to go back to. The
 * system Back gesture still runs `onBack` on a root page, and the leading
 * lane keeps its width so the title stays centred.
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
 *   review step), whose Back steps inside the page. Such a screen always
 *   shows Back, even on a root page.
 * @param {import('react').ReactNode} props.title     centered title text.
 * @param {string} [props.titleId]                    id for naming the screen body.
 * @param {import('react').Ref<HTMLHeadingElement>} [props.titleRef] ref for moving focus to the screen heading.
 * @param {import('react').ReactNode} [props.subtitle]  One small muted line
 *                                                    under the title (a wizard's step).
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
    subtitle = null,
    trailing = null,
}) {
    useBackHandler(onBack, backDisabled, 'route');
    // Null outside a shell (onboarding, a bare render): Back shows there.
    const history = useContext(NavHistoryContext);
    const showBack = Boolean(onBack) && (nested || history === null || history.canGoBack);
    const headerRef = useRef(null);
    // A screen opened from a control on another screen (a detail, a picker)
    // unmounts that control, and focus would fall to <body> and restart Tab at
    // the top of the page. Every screen takes it on its heading, with or
    // without a Back button, unless focus is still on a live control.
    useEffect(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        const heading = headerRef.current?.querySelector('h1');
        if (!heading) return;
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        // A screen that swaps its content in place (a list becoming its edit
        // form) keeps this header mounted and changes only the title.
    }, [typeof title === 'string' ? title : null]); // eslint-disable-line react-hooks/exhaustive-deps
    const accessibleBackLabel = backLabel.trim().toLowerCase() === 'back'
        ? 'Back to previous screen'
        : backLabel;
    return (
        <div ref={headerRef} className={styles.header}>
            {showBack ? (
                // Back is the bare chevron: the shared Button keeps the kit's
                // size, hit area and disabled state, and .back strips the
                // border, outline and fill a button shape would draw.
                <Button
                    size="sm"
                    variant="link"
                    className={styles.back}
                    icon={<BackIcon />}
                    onClick={onBack}
                    aria-label={accessibleBackLabel}
                    disabled={backDisabled}
                />
            ) : (
                <span className={styles.spacer} />
            )}
            <span className={subtitle ? `${styles.titleGroup} ${styles.titleGroupStacked}` : styles.titleGroup}>
                {/* The screen's title is its one top-level heading, so a
                    screen reader can jump to it and announce where the user is. */}
                <h1
                    ref={titleRef}
                    id={titleId}
                    className={styles.title}
                    title={typeof title === 'string' ? title : undefined}
                    tabIndex={titleRef ? -1 : undefined}
                >
                    {title}
                </h1>
                {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
            </span>
            {trailing ? (
                <span className={styles.trailing}>{trailing}</span>
            ) : (
                <span className={styles.spacer} />
            )}
        </div>
    );
}
