// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Switch } from './Switch.jsx';
import styles from './OptionSwitchList.module.css';

/**
 * A group of on/off options (G118): a card of icon rows, each with a switch on
 * the right, never a checkbox list. Put OptionSwitch rows inside it.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 * @param {string} [props.className]
 */
export function OptionSwitchList({ children, className, ...rest }) {
    return (
        <div {...rest} className={[styles.list, className].filter(Boolean).join(' ')}>
            {children}
        </div>
    );
}

/**
 * One row of an OptionSwitchList: the shared Switch with the row styling. Takes
 * the Switch props (icon, label, description, help, checked, onChange, disabled).
 */
export function OptionSwitch({ className, ...props }) {
    return <Switch {...props} className={[styles.row, className].filter(Boolean).join(' ')} />;
}
