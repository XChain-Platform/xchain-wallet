// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AddressText } from '@xchain-wallet/core/ui';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

const rowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
};

export function AddressTextSection() {
    return (
        <Section id="address-text" title="Address text" tag="PRIMITIVE" kicker="A readable, copy-adjacent display treatment for long blockchain addresses.">
            <Guidance
                what={<>Monospace address text that fits its room (G99): the whole address whenever it fits without touching the edges, cut in the middle only when it does not and only as much as needed, with optional positional highlighting.</>}
                when={<>Use for every non-editable address in lists, details, confirmations, summaries and receive surfaces, including a summary line (<code>SummaryAddress</code>).</>}
                whenNot={<>Use <code>Input</code>, <code>AddressField</code>, or <code>AddressCombobox</code> when the value is editable.</>}
                sizing={<><code>sm</code> for dense rows and <code>md</code> for primary details. Fitting is the default: give the address a box with a width of its own (a block, a <code>minmax(0, 1fr)</code> cell, or a <code>flex: 1 1 auto; min-width: 0</code> item); in a row beside a copy icon make the row <code>display: flex; width: 100%</code>.</>}
                variants={<>Fitted (default), fixed six-and-six (<code>fit={'{false}'}</code>, only where a place must stay short by design), or always whole and wrapping (<code>truncate={'{false}'}</code>); plain or highlighted head and tail.</>}
                doRule={<>Keep the complete address in the accessible name and title even when the visible middle is elided.</>}
                dontRule={<>Do not hand-truncate an address in route code, and do not wrap it in a shrink-to-content box that leaves it no room.</>}
            />
            <Markup>
{`import { AddressText } from '@xchain-wallet/core/ui';

<AddressText address={address} highlight />`}
            </Markup>
            <LiveExample label="Fitted (whole when it fits), highlighted, fixed six-and-six, and always-whole treatments.">
                <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch' }}>
                    <AddressText address={ADDRESS} />
                    <AddressText address={ADDRESS} highlight />
                    <AddressText address={ADDRESS} fit={false} />
                    <AddressText address={ADDRESS} truncate={false} size="sm" />
                </div>
            </LiveExample>
        </Section>
    );
}
