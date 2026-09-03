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
import { Screen, PageHeader, Icon } from '@xchain-wallet/core/ui';
import { NetworkFilterDropdown } from './NetworkFilterDropdown.jsx';
import { contactEntryChain } from '../utils/contactChain.js';
import styles from './ContactsPickerScreen.module.css';

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
        for (const c of contacts || []) {
            for (const e of c?.entries || []) {
                if (!e?.address) continue;
                // Resolved, not read raw: an entry the old detector stored as
                // 'unknown' (every Dogecoin testnet address) still has to
                // answer to the Dogecoin filter here as it does in Contacts.
                if (network !== 'all' && contactEntryChain(e) !== network) continue;
                if (q) {
                    const hay = `${c?.name || ''} ${e.address} ${e.label || ''}`.toLowerCase();
                    if (!hay.includes(q)) continue;
                }
                out.push({ contact: c, entry: e });
            }
        }
        return out;
    }, [contacts, query, network]);

    const header = (
        <PageHeader
            onBack={onBack}
            title="Contacts"
            titleIcon={<Icon.UsersIcon />}
        />
    );

    const hasAnyAddress = (contacts || []).some((c) => (c?.entries || []).some((e) => e?.address));
    if (!hasAnyAddress) {
        return (
            <Screen variant={variant} header={header}>
                <div className={styles.emptyCard}>You have no contacts yet</div>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={header}>
            <div className={styles.abToolbar}>
                <input
                    type="text"
                    className={styles.abSearch}
                    placeholder="Search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="Search contacts"
                />
                <NetworkFilterDropdown value={network} onChange={setNetwork} />
            </div>
            {rows.length === 0 ? (
                <div className={styles.abEmpty}>No addresses match your filters.</div>
            ) : (
                <ul className={styles.abList}>
                    {rows.map(({ contact, entry }) => (
                        <li key={`${contact.id}:${entry.address}`}>
                            <button
                                type="button"
                                className={styles.abRow}
                                onClick={() => onPick(entry)}
                            >
                                <span className={styles.abName}>{contact.name}</span>
                                <span className={styles.abAddr} title={entry.address}>{entry.address}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </Screen>
    );
}
