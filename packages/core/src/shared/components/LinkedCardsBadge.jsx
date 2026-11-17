// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import styles from './LinkedCardsBadge.module.css';

/**
 * A round, non-interactive badge that straddles the gap between two stacked
 * cards, the same overlapping circle the Swap form's flip button draws (its
 * row and circle come from the Give/Get stylesheet by `composes`). It says the
 * two cards are tied together, so it is an image with a name, never a button.
 *
 * The parent must stack the cards in a flex column with the 8px gap the Give/Get
 * pair uses; the badge's zero-height row sits in that gap.
 *
 * @param {object} props
 * @param {string} props.label  the accessible name, e.g. "Action 1 is linked to Action 2"
 */
export function LinkedCardsBadge({ label }) {
    return (
        <div className={styles.row} data-linked-cards-badge="">
            <span className={styles.badge} role="img" aria-label={label} title={label}>
                <LinkUpDownIcon />
            </span>
        </div>
    );
}

// A chain link standing upright between an up arrow and a down arrow: the
// first card above is linked to the second card below. Drawn here rather than
// in the shared icon set, on that set's 24px grid and stroke. Its size comes
// from the icon scale (data-xc-icon, the md 18px step), never a literal.
function LinkUpDownIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            data-xc-icon=""
        >
            <path d="M9 4 12 1l3 3" />
            <rect x="9.5" y="5.5" width="5" height="7" rx="2.5" />
            <rect x="9.5" y="11.5" width="5" height="7" rx="2.5" />
            <path d="M9 20l3 3 3-3" />
        </svg>
    );
}
