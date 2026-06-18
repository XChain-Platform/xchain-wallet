// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { BackIcon } from './icons/index.jsx';
import styles from './ScreenHeader.module.css';

/**
 * Shared secondary-toolbar header used by every routed screen.
 *
 * Encapsulates the 3-column grid layout, chevron alignment (lines up
 * under the AppHeader logo via a negative margin-inline-start), title
 * centering, and an optional trailing-action slot. Every route should
 * use this rather than rolling its own `.header` / `.back` / `.title`
 * CSS (see STYLE_GUIDE.md).
 *
 * @param {object} props
 * @param {(() => void) | undefined} [props.onBack]   when present, renders a
 *   back chevron in the leading slot. Omit to render an empty spacer.
 * @param {string} [props.backLabel]                  aria-label for the back
 *   button. Defaults to "Back".
 * @param {import('react').ReactNode} props.title     centered title text.
 * @param {import('react').ReactNode} [props.titleIcon]   optional inline icon
 *   placed immediately to the left of the title (e.g. a route-action glyph
 *   like Send / Receive).
 * @param {import('react').ReactNode} [props.trailing]    right-side slot for
 *   page-scoped actions (filter buttons, scan, etc.). Omit to render an
 *   empty spacer for symmetry.
 */
export function ScreenHeader({
    onBack,
    backLabel = 'Back',
    title,
    titleIcon = null,
    trailing = null,
}) {
    return (
        <div className={styles.header}>
            {onBack ? (
                <button
                    type="button"
                    onClick={onBack}
                    className={styles.back}
                    aria-label={backLabel}
                >
                    <BackIcon />
                </button>
            ) : (
                <span className={styles.spacer} />
            )}
            <span className={styles.titleGroup}>
                {titleIcon ? (
                    <span className={styles.titleIcon} aria-hidden="true">
                        {titleIcon}
                    </span>
                ) : null}
                <span className={styles.title}>{title}</span>
            </span>
            {trailing ? (
                <span className={styles.trailing}>{trailing}</span>
            ) : (
                <span className={styles.spacer} />
            )}
        </div>
    );
}
