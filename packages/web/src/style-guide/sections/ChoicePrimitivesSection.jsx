// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { AddressCombobox, Icon, IconSelect } from '@xchain-wallet/core/ui';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

const DELIVERY_OPTIONS = [
    { value: 'encrypted', label: 'Encrypted', sub: 'Only the recipient can read it', icon: <Icon.LockIcon /> },
    { value: 'public', label: 'Public', sub: 'Stored as readable chain data', icon: <Icon.SendIcon /> },
];

const DESTINATIONS = [
    {
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        label: 'Alice',
        sublabel: 'Bitcoin',
        source: 'contact',
    },
    {
        address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        label: 'Treasury',
        sublabel: 'Last used yesterday',
        source: 'history',
    },
];

function IconSelectExample() {
    const [value, setValue] = useState('encrypted');
    return (
        <IconSelect
            label="Delivery"
            value={value}
            onChange={setValue}
            options={DELIVERY_OPTIONS}
        />
    );
}

function AddressComboboxExample() {
    const [value, setValue] = useState('');
    return (
        <AddressCombobox
            label="To"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            suggestions={DESTINATIONS}
            placeholder="Address or contact"
        />
    );
}

export function IconSelectSection() {
    return (
        <Section
            id="icon-select"
            title="Icon select"
            tag="PRIMITIVE"
            kicker="A form select for choices whose icon and supporting line carry meaning that a native option cannot show."
        >
            <Guidance
                what={<>A single-choice listbox with an Input-sized trigger, an icon, a primary label, and optional supporting copy for every option.</>}
                when={<>Use for a short set of choices that users distinguish visually, such as encrypted versus public delivery.</>}
                whenNot={<>Use <code>Select</code> for text-only choices and <code>ChainPicker</code> for networks.</>}
                sizing={<>The trigger fills its form column and matches the standard field height. Keep option labels short enough to remain on one line at 360px.</>}
                variants={<>Optional label, placeholder, disabled state, option icon, and option supporting text.</>}
                doRule={<>Pass a stable value and update it through <code>onChange</code>. Give every icon a text label beside it.</>}
                dontRule={<>Do not use decorative icons as the only distinction between options.</>}
            />
            <Markup>
{`import { Icon, IconSelect } from '@xchain-wallet/core/ui';

<IconSelect
    label="Delivery"
    value={delivery}
    onChange={setDelivery}
    options={[
        { value: 'encrypted', label: 'Encrypted', icon: <Icon.LockIcon /> },
        { value: 'public', label: 'Public', icon: <Icon.SendIcon /> },
    ]}
/>`}
            </Markup>
            <LiveExample label="Open the trigger to compare icon-led options.">
                <IconSelectExample />
            </LiveExample>
        </Section>
    );
}

export function AddressComboboxSection() {
    return (
        <Section
            id="address-combobox"
            title="Address combobox"
            tag="PRIMITIVE · compatibility"
            kicker="An editable address field with contact and recent-destination suggestions. New transaction forms use AddressField plus the full-screen picker, while existing autocomplete flows keep this primitive."
        >
            <Guidance
                what={<>An <code>Input</code>-compatible combobox that filters suggestions as the user types and supports arrow-key selection.</>}
                when={<>Maintain an existing flow whose product contract calls for inline contact or recent-address autocomplete.</>}
                whenNot={<>For new To and From fields, use <code>AddressField</code> and navigate to the appropriate picker screen.</>}
                sizing={<>Supports <code>md</code> and <code>lg</code>. Its suggestion popover stays anchored to the field at Mobile, Extension, and Desktop widths.</>}
                variants={<>Contact and history suggestions, optional trailing contacts or own-address action, hint and error states.</>}
                doRule={<>Build suggestions with the shared recent-destinations flow and preserve free typing and pasting.</>}
                dontRule={<>Do not introduce this autocomplete pattern on a new transaction form.</>}
                supersedes={<>Nothing. <code>AddressField</code> is the preferred primitive for new address inputs.</>}
            />
            <Markup>
{`import { AddressCombobox } from '@xchain-wallet/core/ui';

<AddressCombobox
    label="To"
    value={to}
    onChange={(event) => setTo(event.target.value)}
    suggestions={recentDestinations}
    placeholder="Address or contact"
/>`}
            </Markup>
            <LiveExample label="Focus the field, type a contact name, or use the arrow keys.">
                <AddressComboboxExample />
            </LiveExample>
        </Section>
    );
}
