// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The collapse handle (G100): a small raised tab with a chevron that
// collapses and restores a panel. The side menu wears it on its edge
// (vertical: a 10 by 40px tab hanging off the menu, its chevron pointing
// back while open) and wide Home wears it hanging under the divider below
// its top section, centred along it (horizontal: the same tab turned a
// quarter, its chevron pointing up while open). One component, so the two
// read as one control.
//
// The handle draws the tab, the chevron and the 24px hit area; where it sits
// is the caller's: pass a class that positions it (absolutely) on its edge
// or line.

import { Button, Icon } from '@xchain-wallet/core/ui';
import styles from './CollapseHandle.module.css';

/**
 * @param {object} props
 * @param {'vertical' | 'horizontal'} [props.orientation]  vertical rides a side edge, horizontal sits on a line
 * @param {boolean} props.collapsed                       whether the panel it controls is collapsed
 * @param {string} props['aria-label']                    what a press does (Collapse ... / Expand ...)
 * @param {string} [props.className]                      the caller's placement class
 */
export function CollapseHandle({ orientation = 'vertical', collapsed, className, 'aria-label': ariaLabel, ...rest }) {
    // An icon-only control: its accessible name is the required aria-label.
    return (
        <Button
            variant="ghost"
            {...rest}
            aria-label={ariaLabel}
            className={className ? `${styles.handle} ${className}` : styles.handle}
            data-orientation={orientation}
            data-collapsed={collapsed ? 'true' : 'false'}
            icon={<span className={styles.chevron}><Icon.BackIcon /></span>}
            aria-expanded={!collapsed}
        />
    );
}
