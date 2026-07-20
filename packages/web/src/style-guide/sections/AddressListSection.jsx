// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import { NetworkFilterDropdown } from '@xchain-wallet/core/shared/components/NetworkFilterDropdown.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import styles from './AddressListSection.module.css';

const ROWS = [
    { name: 'Erin Calloway', address: 'bc1qd0nateja8l9am8tqpzjn9uazhf6dlp9qer2tra' },
    { name: 'Cold storage', address: 'bc1qexamplecoldstoragevault00000000000000042' },
    { name: 'Miner payouts', address: 'ltc1qexampleminerpayoutaddr000000000000007' },
    { name: 'Doge tip jar', address: 'D7exampleDogeTipJarAddress00000000001' },
];

export function AddressListSection() {
    const [network, setNetwork] = useState('all');
    return (
        <Section
            id="address-list"
            title="Address list (contacts / address book)"
            tag="CANONICAL pick-an-address page"
            kicker="The address book pattern used by Contacts and the Send / Compose address pickers: a toolbar with free-text search and the network filter dropdown, above one card listing contact name + monospaced address per row. Selecting a row fills the caller's address field."
        >
            <Guidance
                what={<>The selector-page shape with a different toolbar right side: search keeps <code>flex: 1</code>, and the segmented control is replaced by <code>NetworkFilterDropdown</code> (trigger + popover with chain icons; a native select can't render images). The card is a <code>&lt;ul&gt;</code> of two-line rows: contact name (weight 700) over the full address in <code>--xc-font-mono</code>, ellipsized.</>}
                when={<>Anywhere the user picks a saved address: the Contacts screen, the address-book icon inside Send's To field, the compose-message recipient picker. Also the model for any list filtered by network rather than by asset kind (My Dispensers follows it).</>}
                whenNot={<>Choosing an asset → token selector (segments, not the dropdown) · showing the wallet's own receive addresses (that page adds derivation metadata and QR affordances) · one-off address display → <code>AddressText</code> inline.</>}
                sizing={<>Toolbar: gap <code>--xc-space-2</code>, bottom margin <code>--xc-space-2</code>; search and dropdown share the row, dropdown sizes to its container. Rows: column layout, 2px gap, padding <code>--xc-space-3</code>, hairline top borders. Name <code>--xc-text-md</code> weight 700; address <code>--xc-text-xs</code> mono muted, <code>text-overflow: ellipsis</code>.</>}
                doRule={<>✓ Always ellipsize the address (middle truncation is fine via <code>AddressText</code>) rather than wrapping · filter on BOTH name and address text · keep the network dropdown's "All Networks" as the default state · show the calm single-card empty state ("You have no contacts yet") when the book is empty, and the in-card empty line when filters match nothing</>}
                dontRule={<>✗ Add per-row action buttons inside a picker (row tap = select; management lives on the Contacts screen) · show balances on address rows · use chain pips on the left (network identity comes from the address itself and the active filter)</>}
                supersedes={<>The <code>.abToolbar</code> / <code>.abSearch</code> / <code>.abList</code> / <code>.abRow</code> rules in <code>ContactsPickerScreen.module.css</code> and <code>NetworkFilterDropdown.jsx</code>. The canonical implementation lives there.</>}
            />

            <Markup>
{`<ContactsPickerScreen
    contacts={contacts}
    variant={variant}
    onPick={(entry) => fillAddress(entry.address)}
    onBack={closePicker}
/>`}
            </Markup>

            <LiveExample label="Search + network dropdown above the contact card (dropdown is live)">
                <div className={styles.abToolbar}>
                    <input type="text" className={styles.abSearch} placeholder="Search name or address" readOnly />
                    <NetworkFilterDropdown value={network} onChange={setNetwork} />
                </div>
                <ul className={styles.abList}>
                    {ROWS.map((r) => (
                        <li key={r.address}>
                            <button type="button" className={styles.abRow}>
                                <span className={styles.abName}>{r.name}</span>
                                <span className={styles.abAddr} title={r.address}>{r.address}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </LiveExample>

            <LiveExample label="Filtered-to-nothing state (inside the card)">
                <ul className={styles.abList}>
                    <li><div className={styles.abEmpty}>No addresses match your filters.</div></li>
                </ul>
            </LiveExample>
        </Section>
    );
}
