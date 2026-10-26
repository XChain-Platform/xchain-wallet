// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useMemo, useState } from 'react';
import { EmptyState, Icon, Input, ListPage, ListRow, PageHeader, Screen } from '@xchain-wallet/core/ui';
import { NetworkFilterDropdown } from './NetworkFilterDropdown.jsx';
import { contactEntryChain } from '../utils/contactChain.js';
import { compareContactsByName } from '../utils/contactMerge.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import styles from './ContactsPickerScreen.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/routes.js';

export { styles as contactsPickerStyles };

/**
 * Full-screen address-book picker, rendered in place of the calling form
 * when the user taps the contacts icon in an address field. Shows saved
 * contact addresses across all networks with a 50/50 search + network-filter
 * toolbar. Selecting a row hands the entry back to the caller, which fills
 * its address field and returns to the form with all other state intact.
 *
 * Search/filter state lives here: the component mounts fresh on every open,
 * so the caller doesn't reset anything.
 *
 * @param {object} props
 * @param {any[]} props.contacts            rows from messaging.listContacts()
 * @param {'small' | 'full'} props.variant  Screen variant of the calling form
 * @param {(entry: { address: string, chain?: string, label?: string }) => void} props.onPick
 * @param {() => void} props.onBack
 */
export function ContactsPickerScreen({ contacts, variant, onPick, onBack }) {
    const [query, setQuery] = useState('');
    const [network, setNetwork] = useState('all');

    // All saved addresses across every contact, flattened and filtered by
    // the network dropdown + search box.
    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        const out = [];
        // Name order, matching the Contacts screen, so a person's addresses
        // sit together however the vault happened to store them.
        for (const [contactIndex, c] of [...(Array.isArray(contacts) ? contacts : [])]
            .sort(compareContactsByName).entries()) {
            for (const [entryIndex, e] of (Array.isArray(c?.entries) ? c.entries : []).entries()) {
                if (!e?.address) continue;
                // Resolved, not read raw: an entry the old detector stored as
                // 'unknown' (every Dogecoin testnet address) still has to
                // answer to the Dogecoin filter here as it does in Contacts.
                if (network !== 'all' && contactEntryChain(e) !== network) continue;
                if (q) {
                    const hay = `${c?.name || ''} ${e.address} ${e.label || ''}`.toLowerCase();
                    if (!hay.includes(q)) continue;
                }
                out.push({
                    displayName: neutralizeControlText(c?.name),
                    entry: e,
                    key: `${contactIndex}:${entryIndex}`,
                });
            }
        }
        return out;
    }, [contacts, query, network]);

    const header = (
        <PageHeader
            nested
            onBack={onBack}
            title={t('components.contactsPickerScreen.contacts')}
            titleIcon={<Icon.UsersIcon />}
        />
    );

    const hasAnyAddress = (Array.isArray(contacts) ? contacts : [])
        .some((c) => (Array.isArray(c?.entries) ? c.entries : []).some((e) => e?.address));
    if (!hasAnyAddress) {
        return (
            <Screen variant={variant} header={header}>
                <ListPage>
                    <EmptyState
                        title={t('components.contactsPickerScreen.noContactsYet')}
                        body={t('components.contactsPickerScreen.savedContactsWithAddressesAppear')}
                        titleAs="p"
                        role={null}
                    />
                </ListPage>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={header}>
            <ListPage toolbar={(
                <>
                    <Input
                        type="search"
                        size="md"
                        enterKeyHint="search"
                        autoCapitalize="off"
                        className={styles.abSearch}
                        placeholder={t('routes.addressList.search')}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        aria-label={t('components.contactsPickerScreen.searchContacts')}
                    />
                    <NetworkFilterDropdown value={network} onChange={setNetwork} />
                </>
            )}>
                {rows.length === 0 ? (
                    <EmptyState
                        title={t('routes.addressList.noMatchingAddresses')}
                        body={t('routes.addressList.tryADifferentSearchOr')}
                        titleAs="p"
                        role={null}
                    />
                ) : (
                    <ul className={styles.abList}>
                        {rows.map(({ displayName, entry, key }) => (
                            <li key={key}>
                                <ListRow
                                    className={styles.abRow}
                                    onClick={() => onPick(entry)}
                                    title={<span className={styles.abName}>{displayName}</span>}
                                    subtitle={(
                                        <span className={styles.abAddr} title={entry.address}>{entry.address}</span>
                                    )}
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </ListPage>
        </Screen>
    );
}
