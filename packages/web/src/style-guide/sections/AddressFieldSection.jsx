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
import { AddressCombobox } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

// Doc-page suggestion fixture. In-app these come from
// flows/recentDestinations.buildRecentDestinations (contacts + recent-send
// history); the shape is { address, label, sublabel?, source }.
const SAMPLE_SUGGESTIONS = [
    { address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', label: 'Alice (savings)', sublabel: 'Bitcoin · contact', source: 'contact' },
    { address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', label: 'bc1q…5mdq', sublabel: 'Sent twice · Bitcoin', source: 'history' },
];

export function AddressFieldSection() {
    const [mdVal, setMdVal] = useState('');
    const [lgVal, setLgVal] = useState('');
    return (
        <Section
            id="address-field"
            title="Address field"
            tag="CANONICAL destination input"
            kicker="The recipient/destination input used by Send and any form that takes an address. A text field with autocomplete drawn from the user's contacts and recent-send history. Shares the Input size contract."
        >
            <Guidance
                what={<>A thin wrapper around <code>Input</code> (<code>AddressCombobox</code>) that adds a <code>role="combobox"</code> autocomplete popover of contact + recent-send suggestions with keyboard navigation. The host builds the suggestion list via <code>flows/recentDestinations.buildRecentDestinations</code> and passes it in; the component owns filtering, dropdown visibility, and selection. All other props (<code>label</code>, <code>placeholder</code>, <code>size</code>, <code>error</code>) forward to the underlying <code>Input</code>.</>}
                when={<>Any field that takes a transaction destination the user might have sent to before or saved as a contact: Send's To, cross-chain "Receive at", dispenser/oracle destination fields. Prefer this over a bare <code>Input</code> so contacts and recents surface consistently everywhere.</>}
                whenNot={<>Contact-book address entry where you're recording a brand-new address (no autocomplete-against-self needed) can stay a plain <code>Input</code>. Not for amounts, tickers, or memos.</>}
                sizing={<>Inherits the Input size contract: <code>md</code> (36px, default) or <code>size="lg"</code> (48px) for Send's hero To field. The dropdown width tracks the input.</>}
                variants={<><code>size="md" | "lg"</code>. <code>onPaste</code> for BIP21 / WIF detection (Send wires this). <code>suggestions</code> defaults to an empty list (the field then behaves as a plain input).</>}
                doRule={<>✓ Feed real suggestions from <code>buildRecentDestinations</code> · pass <code>size="lg"</code> only on hero screens · keep the placeholder instructive ("Enter or paste an address or name…")</>}
                dontRule={<>✗ Roll your own address input with a bespoke dropdown · apply big-field styling by inline style (use <code>size</code>)</>}
                supersedes={<>Bare address <code>Input</code>s in transaction forms. The component lives at <code>packages/core/src/ui/AddressCombobox.jsx</code>; suggestion building at <code>packages/core/src/flows/recentDestinations.js</code>.</>}
            />

            <Markup>
{`import { AddressCombobox } from '@xchain-wallet/core/ui';
import { buildRecentDestinations } from '@xchain-wallet/core/flows/recentDestinations';

const suggestions = buildRecentDestinations({ contacts, history, chainId });

<AddressCombobox
    label="To"
    size="lg"                       // md (default) elsewhere
    value={to}
    onChange={(e) => setTo(e.target.value)}
    suggestions={suggestions}
    onPaste={handleBip21Paste}
    placeholder="Enter or paste an address or name…"
/>`}
            </Markup>

            <LiveExample label="Default (md). Focus the field and type to reveal the contact + recent autocomplete.">
                <AddressCombobox
                    label="To"
                    value={mdVal}
                    onChange={(e) => setMdVal(e.target.value)}
                    suggestions={SAMPLE_SUGGESTIONS}
                    placeholder="Enter or paste an address or name…"
                />
            </LiveExample>

            <LiveExample label="Hero (lg): Send's To field.">
                <AddressCombobox
                    label="To"
                    size="lg"
                    value={lgVal}
                    onChange={(e) => setLgVal(e.target.value)}
                    suggestions={SAMPLE_SUGGESTIONS}
                    placeholder="Enter or paste an address or name…"
                />
            </LiveExample>
        </Section>
    );
}
