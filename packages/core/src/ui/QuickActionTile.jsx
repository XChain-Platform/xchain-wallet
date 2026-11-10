// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { forwardRef } from 'react';
import { Button } from './Button.jsx';
import styles from './QuickActionTile.module.css';

/**
 * One quick-action tile, shared by Home, token detail and the style guide so
 * every screen draws the same square: a secondary Button with the icon over
 * its label. The screen's row lays the tiles out; the tile owns its look.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.icon   the glyph, wrapped in the shared icon slot
 * @param {string} [props.className]                 extra classes from the screen's row
 * @param {import('react').ReactNode} props.children the label
 * @param {import('react').Ref<HTMLButtonElement>} [ref]
 */
export const QuickActionTile = forwardRef(function QuickActionTile({
    icon,
    className,
    children,
    ...rest
}, ref) {
    return (
        <Button
            {...rest}
            ref={ref}
            variant="secondary"
            className={[styles.tile, className].filter(Boolean).join(' ')}
            icon={<span className={styles.icon}>{icon}</span>}
        >
            {children}
        </Button>
    );
});

export { styles as quickActionTileStyles };
