// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Button, Icon, ListPage, PageHeader, Screen, SectionHeader } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import styles from './ActionsMenu.module.css';

const SIGNER_ACTION_IDS = new Set(['sign-psbt', 'sign-message', 'verify-signature']);

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
 * @typedef {{ id: string, label: string, description?: string, group?: string, groupLabel?: string, onSelect?: () => void, disabled?: boolean, disabledReason?: string }} ActionEntry
 *
 * @param {object} props
 * @param {ActionEntry[]} props.entries
 * @param {() => void} props.onBack
 */
export function ActionsMenu({ entries, onBack }) {
    const { shell } = useMessaging();
    const { isSignerMode } = useWalletMode();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const visibleEntries = entries.filter((entry) => {
        if (isSignerMode && !SIGNER_ACTION_IDS.has(entry.id)) return false;
        return typeof entry.onSelect === 'function'
            || (entry.disabled === true && Boolean(entry.disabledReason));
    });
    const groups = [];
    for (const entry of visibleEntries) {
        const groupId = entry.group || 'other';
        let group = groups.find((candidate) => candidate.id === groupId);
        if (!group) {
            group = { id: groupId, label: entry.groupLabel || 'More actions', entries: [] };
            groups.push(group);
        }
        group.entries.push(entry);
    }

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Token actions"
            titleIcon={<Icon.TokenIcon />}
        />
    );
    return (
        <Screen variant={variant} header={header}>
            <ListPage>
                {groups.map((group) => {
                    const headingId = `action-group-${group.id}`;
                    return (
                        <section key={group.id} aria-labelledby={headingId}>
                            <SectionHeader id={headingId} title={group.label} />
                            <ul className={isFull ? styles.listFull : styles.listPopup}>
                                {group.entries.map((entry) => {
                                    const EntryIcon = Icon.iconForLabel(entry.label);
                                    const descriptionId = entry.description
                                        ? `action-${entry.id}-description`
                                        : undefined;
                                    const reasonId = entry.disabledReason
                                        ? `action-${entry.id}-reason`
                                        : undefined;
                                    return (
                                        <li key={entry.id} className={styles.listItem}>
                                            <Button
                                                type="button"
                                                className={styles.entry}
                                                onClick={entry.disabled ? undefined : entry.onSelect}
                                                aria-disabled={entry.disabled ? 'true' : undefined}
                                                aria-describedby={[descriptionId, reasonId].filter(Boolean).join(' ') || undefined}
                                            >
                                                {EntryIcon ? (
                                                    <span className={styles.entryIcon} aria-hidden="true">
                                                        <EntryIcon />
                                                    </span>
                                                ) : null}
                                                <span className={styles.entryText}>
                                                    <span className={styles.entryLabel}>{entry.label}</span>
                                                    {entry.description ? (
                                                        <span id={descriptionId} className={styles.entryDescription}>
                                                            {entry.description}
                                                        </span>
                                                    ) : null}
                                                    {entry.disabledReason ? (
                                                        <span id={reasonId} className={styles.entryReason}>
                                                            Unavailable: {entry.disabledReason}
                                                        </span>
                                                    ) : null}
                                                </span>
                                            </Button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    );
                })}
            </ListPage>
        </Screen>
    );
}
