// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// NetworkRowList: the list half of a Settings page that shows one row per
// active network (icon, name, one-line summary of the current setting, a
// chevron). A row opens that network's own Settings page through `onOpen`;
// Settings owns the title bar and Back, so Back returns to this list. Fees
// and Network endpoints use it so the page never grows with the number of
// networks (operator rule G117: forms never list every network inline).

import { ListRow } from '@xchain-wallet/core/ui';
import { NetworkMark } from './TestNetworksPages.jsx';
import styles from './NetworkRowsPage.module.css';

const LIST_SURFACE = { border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', background: 'var(--xc-surface)' };

/**
 * @param {object} props
 * @param {string} [props.groupLabel]          the small label over the list
 * @param {string} [props.listLabel]           the list's accessible name when no label shows over it
 * @param {Array<{ id: string, descriptor: object, name: string, summary: string }>} props.rows
 * @param {(chainId: string) => void} [props.onOpen]   opens one network's page
 * @param {import('react').ReactNode} [props.above]    shown over the list
 */
export function NetworkRowList({ groupLabel, listLabel, rows, onOpen, above }) {
    return (
        <div className={styles.page}>
            {above}
            <div className={styles.group}>
                {groupLabel ? <div className={styles.groupLabel}>{groupLabel}</div> : null}
                {/* The same inline surface as Settings' group lists: the flat page
                    surface is still a card, so the nested-card rule would strip a
                    class border. */}
                {/* Safari needs an explicit list role because this class removes list styling. */}
                <ul className={styles.card} role="list" aria-label={groupLabel || listLabel} style={LIST_SURFACE}>
                    {rows.map((r) => (
                        <li key={r.id} data-network-row={r.id}>
                            <ListRow
                                onClick={() => onOpen?.(r.id)}
                                leading={<NetworkMark descriptor={r.descriptor} />}
                                title={r.name}
                                trailing={r.summary}
                                chevron
                            />
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
