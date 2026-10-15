// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Children } from 'react';
import { Input } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import styles from './ListToolbar.module.css';

/**
 * The search-and-filter row every list screen puts in ListPage's toolbar
 * slot: a search box first, then the screen's filters (the network picker,
 * a sort control), each taking an equal share of the row and wrapping onto
 * its own line when the window is too narrow for them side by side.
 *
 * @param {object} props
 * @param {string} props.query
 * @param {(value: string) => void} props.onQueryChange
 * @param {string} props.searchLabel   accessible name of the search box, e.g. "Search contacts"
 * @param {import('react').ReactNode} [props.children]   filter controls after the search box
 */
export function ListToolbar({ query, onQueryChange, searchLabel, children }) {
    return (
        <div className={styles.toolbar}>
            <div className={styles.field}>
                <Input
                    type="search"
                    size="md"
                    enterKeyHint="search"
                    autoCapitalize="off"
                    placeholder={t('routes.addressList.search')}
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label={searchLabel}
                />
            </div>
            {Children.toArray(children).map((child, index) => (
                <div className={styles.field} key={child.key ?? index}>{child}</div>
            ))}
        </div>
    );
}
