// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ListField } from '@xchain-wallet/core/shared/components/ListField.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const noop = () => {};

export function ListFieldSection() {
    const [allowList, setAllowList] = useState(null);
    return (
        <Section
            id="list-field"
            title="List field"
            tag="CANONICAL · ListField"
            kicker="The inline list selector for forms, built like TokenField: a field-shaped button that opens the host's list picker."
        >
            <Guidance
                what={<><code>ListField</code> shows the chosen list's text (or the placeholder) with the list icon at its trailing edge. It is presentation and click only: the host opens its <code>ListPickerScreen</code> from <code>onOpenPicker</code> and writes the choice back through <code>valueText</code>. With <code>onClear</code> and a value, a clear action sits inside the field.</>}
                when={<>A form that refers to an address list you published: the allow and block lists on Create Order, Swap and Cross-Chain Swap, a dispenser's access lists and the token admin form.</>}
                whenNot={<>Typing a list index by hand and picking a token (use <code>TokenField</code>).</>}
                doRule={<>✓ Pass <code>onClear</code> and a <code>clearLabel</code> on optional lists · put the member count in <code>valueText</code> when known</>}
                dontRule={<>✗ Render a numeric input for the list index · nest the clear button inside the field button</>}
                supersedes={<>Source: <code>ListField.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<ListField
    label="Allow list"
    help="Only addresses on this list can match the order."
    placeholder="Select allow list"
    valueText={allowListIdx ? \`Allow list #\${allowListIdx} · \${count} members\` : null}
    onOpenPicker={() => setListPickerFor('allow')}
    onClear={() => setAllowListIdx('')}
    clearLabel="Clear allow list"
/>`}
            </Markup>
            <LiveExample label="Empty (tap to pick), then chosen with its clear action">
                <div style={{ display: 'grid', gap: 'var(--xc-form-gap)' }}>
                    <ListField
                        label="Allow list"
                        help="Only addresses on this list can match the order."
                        placeholder="Select allow list"
                        valueText={allowList}
                        onOpenPicker={() => setAllowList('Allow list #4210 · 12 members')}
                        onClear={() => setAllowList(null)}
                        clearLabel="Clear allow list"
                    />
                    <ListField
                        label="Block list"
                        placeholder="Select block list"
                        valueText="Block list #3907 · 3 members"
                        onOpenPicker={noop}
                        onClear={noop}
                        clearLabel="Clear block list"
                    />
                    <ListField label="Access list" placeholder="Select access list" onOpenPicker={noop} disabled />
                </div>
            </LiveExample>
        </Section>
    );
}
