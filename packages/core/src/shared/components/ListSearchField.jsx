// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Icon, Input } from '@xchain-wallet/core/ui';
import styles from './ListSearchField.module.css';

/**
 * The search box Home's filter panel uses: a search icon, the kit Input and
 * the browser's own clear control, so every list filter panel reads alike.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} props.placeholder
 * @param {string} [props.label]   accessible name; defaults to the placeholder
 */
export function ListSearchField({ value, onChange, placeholder, label }) {
    return (
        <div className={styles.searchWrap}>
            <span className={styles.searchIcon} aria-hidden="true">
                <Icon.SearchIcon />
            </span>
            <Input
                type="search"
                size="md"
                enterKeyHint="search"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={styles.search}
                placeholder={placeholder}
                aria-label={label || placeholder}
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
}
