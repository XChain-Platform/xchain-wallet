// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { ContactsPickerScreen } from '@xchain-wallet/core/shared/components/ContactsPickerScreen.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const CONTACTS = [
    {
        id: 'contact-erin',
        name: 'Erin Calloway',
        entries: [
            { chain: 'bitcoin', label: 'Savings', address: 'bc1qd0nateja8l9am8tqpzjn9uazhf6dlp9qer2tra' },
            { chain: 'litecoin', label: 'Everyday', address: 'ltc1qg82w3d7z4h3s4q6jh8v2c5x9n0m2ka7yp6tdgw' },
        ],
    },
    {
        id: 'contact-miner',
        name: 'Miner payouts',
        entries: [
            { chain: 'dogecoin', address: 'D7Y55nwG7h3bRGW6z9pKcY8yXzW4aMNc2D' },
        ],
    },
];

export function AddressListSection() {
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
{`import { ContactsPickerScreen } from '@xchain-wallet/core/shared/components/ContactsPickerScreen.jsx';

<ContactsPickerScreen
    contacts={contacts}
    variant={variant}
    onPick={(entry) => fillAddress(entry.address)}
    onBack={closePicker}
/>`}
            </Markup>

            <LiveExample label="Search + network dropdown above the contact card (both are live)" padded={false}>
                <ContactsPickerScreen
                    contacts={CONTACTS}
                    variant="full"
                    onPick={() => {}}
                    onBack={() => {}}
                />
            </LiveExample>

            <LiveExample label="Empty contact book" padded={false}>
                <ContactsPickerScreen
                    contacts={[]}
                    variant="full"
                    onPick={() => {}}
                    onBack={() => {}}
                />
            </LiveExample>
        </Section>
    );
}
