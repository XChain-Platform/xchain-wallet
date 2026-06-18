// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Screen, ScreenHeader, Icon } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ActionsMenu.module.css';

/**
 * Actions menu: secondary authoring surface listed in §40.
 *
 * Home keeps the common three actions (Send / Receive / Create a token)
 * above the fold; everything else (standalone ISSUE §40.2, MINT §40.3,
 * DESTROY §40.4, token admin §40.5, BROADCAST §40.6, dispenser §40.7.1,
 * …) lands here. Until the Token detail page (§36 / §33) exists, this
 * menu also plays the role those per-token menus will eventually play.
 *
 * Entries are passed in as a prop so each host (popup, web) can choose
 * which items to surface and wire each one to its own sub-route.
 *
 * @typedef {{ id: string, label: string, description?: string, onSelect: () => void, disabled?: boolean }} ActionEntry
 *
 * @param {object} props
 * @param {ActionEntry[]} props.entries
 * @param {() => void} props.onBack
 */
export function ActionsMenu({ entries, onBack }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const header = (
        <ScreenHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Token Actions"
            titleIcon={<Icon.TokenIcon />}
        />
    );
    return (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.listFull : styles.listPopup}>
                {entries.map((e) => {
                    const EntryIcon = Icon.iconForLabel(e.label);
                    return (
                        <button
                            key={e.id}
                            type="button"
                            className={styles.entry}
                            onClick={e.onSelect}
                            disabled={e.disabled}
                        >
                            {EntryIcon ? (
                                <span className={styles.entryIcon} aria-hidden="true">
                                    <EntryIcon />
                                </span>
                            ) : null}
                            <span className={styles.entryText}>
                                <span className={styles.entryLabel}>{e.label}</span>
                                {e.description ? (
                                    <span className={styles.entryDescription}>{e.description}</span>
                                ) : null}
                            </span>
                        </button>
                    );
                })}
            </div>
            <div className={styles.actions}>
            </div>
        </Screen>
    );
}
