// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import styles from './DraftDiscardButton.module.css';

/**
 * The inline "Discard" link inside a form's saved-draft banner.
 *
 * Send, Create dispenser, Issue token and Sign message each carried their
 * own inline-styled copy of this button with `padding: 0` and an extra-small
 * font, which rendered it 12px tall: half the 24px pointer-target floor
 * (WCAG 2.2 AA 2.5.8). Inline styles are also invisible to the stylesheet
 * tap-target sweep, so the miss only showed up in the browser walk. One
 * component with a CSS module keeps the floor stated where the sweep reads it.
 *
 * @param {object} props
 * @param {() => void} props.onClick
 * @param {string} props.label    accessible name, e.g. "Discard saved draft"
 * @param {import('react').ReactNode} props.children   visible text
 */
export function DraftDiscardButton({ onClick, label, children }) {
    return (
        <button
            type="button"
            className={styles.discard}
            onClick={onClick}
            aria-label={label}
        >
            {children}
        </button>
    );
}
