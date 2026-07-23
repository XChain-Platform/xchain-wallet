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
import { AddressField } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const OWN_ADDRESSES = [
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    'bc1qd0nateja8l9am8tqpzjn9uazhf6dlp9qer2tra',
];

export function AddressFieldSection() {
    const [toVal, setToVal] = useState('');
    const [toNote, setToNote] = useState('');
    const [fromIdx, setFromIdx] = useState(0);
    const [fromNote, setFromNote] = useState('');
    return (
        <Section
            id="address-field"
            title="Address fields (To / From)"
            tag="CANONICAL address inputs"
            kicker="The two standard address fields for transaction forms. To: an outbound destination the user types or pastes, with an address-book icon that navigates to saved contacts. From: the wallet-controlled source address, read-only, with a QR icon that navigates to the wallet's own address list to pick one."
        >
            <Guidance
                what={<>A standard <code>Input</code> with one trailing icon action inside the field (<code>AddressField</code>). <code>icon="contacts"</code> renders the address-book icon; <code>icon="addresses"</code> renders the QR icon. The component renders the field + icon only; the host owns the full-screen picker the icon navigates to and writes the result back into the field. No autocomplete popover: picking happens on the picker screen, not in a dropdown under the field.</>}
                when={<>To ("contacts"): any outbound destination field: Send's To, compose-message recipient, oracle destination. Free entry stays enabled so pasting an address always works; the icon opens <code>ContactsPickerScreen</code> and the picked entry fills the field. From ("addresses"): any field that selects which of the wallet's OWN addresses a transaction spends from or acts on. Read-only; the icon opens the own-address list (the same screen as change-address) and the pick becomes the field value.</>}
                whenNot={<>Contact-book entry of a brand-new address stays a plain <code>Input</code>. One-off address display with no action → <code>AddressText</code> inline. Not for amounts, tickers, or memos.</>}
                sizing={<>Inherits the Input size contract: <code>md</code> (36px, default) or <code>size="lg"</code> (48px) for hero fields like Send's To. Icon button is 44px wide, anchored over the input box only (hint/error lines never move it).</>}
                variants={<><code>icon="contacts" | "addresses"</code> · <code>size="md" | "lg"</code> · <code>readOnly</code> (always set on From) · <code>onPaste</code> for BIP21 / WIF detection (Send wires this) · <code>iconLabel</code> to override the accessible label.</>}
                doRule={<>✓ Keep To editable (paste must always work) · keep From read-only (own addresses only come from the picker) · use the QR icon ONLY for own-address selection and the book icon ONLY for contacts · return from the picker with all other form state intact</>}
                dontRule={<>✗ Add an autocomplete dropdown under the field (superseded; picking happens on the picker screen) · roll a bespoke icon-in-field with absolute positioning (use this component) · use the contacts icon on a From field</>}
                supersedes={<><code>AddressCombobox</code> autocomplete for To fields, and Send's local <code>.inlineContactsButton</code> pattern. The component lives at <code>packages/core/src/ui/AddressField.jsx</code>.</>}
            />

            <Markup>
{`import { AddressField } from '@xchain-wallet/core/ui';

// To: outbound destination, editable, address-book icon -> contacts
<AddressField
    label="To"
    icon="contacts"
    size="lg"                        // md (default) elsewhere
    value={to}
    onChange={(e) => setTo(e.target.value)}
    onIconClick={() => setContactsPickerOpen(true)}
    onPaste={handleBip21Paste}
    placeholder="Enter or paste an address…"
/>

// From: wallet-controlled source, read-only, QR icon -> own addresses
<AddressField
    label="From"
    icon="addresses"
    value={fromAddress.address}
    readOnly
    onIconClick={() => setAddressPickerOpen(true)}
/>`}
            </Markup>

            <LiveExample label="To (md): type or paste freely; the book icon opens the contacts picker.">
                <AddressField
                    label="To"
                    icon="contacts"
                    value={toVal}
                    onChange={(e) => { setToVal(e.target.value); setToNote(''); }}
                    onIconClick={() => setToNote('→ navigates to ContactsPickerScreen; the picked contact address fills the field.')}
                    placeholder="Enter or paste an address…"
                    hint={toNote || undefined}
                />
            </LiveExample>

            <LiveExample label="From (md): read-only; the QR icon opens the wallet's own address list. (Demo cycles addresses.)">
                <AddressField
                    label="From"
                    icon="addresses"
                    value={OWN_ADDRESSES[fromIdx]}
                    readOnly
                    onIconClick={() => {
                        setFromIdx((i) => (i + 1) % OWN_ADDRESSES.length);
                        setFromNote('→ navigates to the own-address list (change-address screen); the pick becomes the field value.');
                    }}
                    hint={fromNote || undefined}
                />
            </LiveExample>

            <LiveExample label="Hero (lg): Send's To field sizing.">
                <AddressField
                    label="To"
                    icon="contacts"
                    size="lg"
                    value=""
                    onChange={() => {}}
                    onIconClick={() => {}}
                    placeholder="Enter or paste an address…"
                />
            </LiveExample>
        </Section>
    );
}
