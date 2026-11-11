// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import styles from './FieldIconButton.module.css';

/** Plain icon action placed at the trailing edge of an Input or Textarea. */
export function FieldIconButton({
    icon,
    label,
    onClick,
    disabled = false,
    'aria-pressed': ariaPressed,
    'aria-expanded': ariaExpanded,
    'aria-controls': ariaControls,
}) {
    return (
        <button
            type="button"
            className={styles.button}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            aria-pressed={ariaPressed}
            aria-expanded={ariaExpanded}
            aria-controls={ariaControls}
        >
            {icon}
        </button>
    );
}
