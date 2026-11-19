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

/**
 * Plain icon action placed at the trailing edge of an Input or Textarea.
 *
 * `lockedReason` shows the action but locks it: the field's value is fixed,
 * so there is nothing to pick. The button stays focusable (aria-disabled, not
 * the native attribute) so a keyboard or screen reader user still reaches it
 * and hears why, from its title, while its name stays the action's own.
 */
export function FieldIconButton({
    icon,
    label,
    onClick,
    disabled = false,
    lockedReason,
    'aria-pressed': ariaPressed,
    'aria-expanded': ariaExpanded,
    'aria-controls': ariaControls,
    'aria-busy': ariaBusy,
}) {
    const locked = Boolean(lockedReason);
    return (
        <button
            type="button"
            className={styles.button}
            onClick={locked ? undefined : onClick}
            disabled={disabled}
            aria-disabled={locked ? 'true' : undefined}
            aria-label={label}
            title={locked ? lockedReason : label}
            aria-pressed={ariaPressed}
            aria-expanded={ariaExpanded}
            aria-controls={ariaControls}
            aria-busy={ariaBusy}
        >
            {icon}
        </button>
    );
}
