// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { NativeFeeToggle } from '@xchain-wallet/core/shared/components/NativeFeeToggle.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const noop = () => {};

export function NativeFeeToggleSection() {
    const [on, setOn] = useState(true);
    return (
        <Section
            id="native-fee-toggle"
            title="Protocol fee toggle"
            tag="CANONICAL · NativeFeeToggle"
            kicker="The row on an action form that chooses how the protocol fee is paid: as the coin equivalent on chain, or from the token balance."
        >
            <Guidance
                what={<><code>&lt;NativeFeeToggle checked onChange coinTicker mandatory unverified fee /&gt;</code>. A choice renders a switch row; a chain with no choice, or an action whose fee is zero, renders a plain statement row on the same card.</>}
                when={<>Inside the Fees section of the Form Standard, for actions that carry a protocol fee.</>}
                whenNot={<>Plain coin sends: they have no protocol fee.</>}
                doRule={<>✓ Pass <code>mandatory</code> when the chain gives no choice</>}
                dontRule={<>✗ Hide the row when the fee is zero (the statement row says so)</>}
                supersedes={<>Source: <code>NativeFeeToggle.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<NativeFeeToggle checked={on} onChange={setOn} coinTicker="BTC" />`}
            </Markup>
            <LiveExample label="Choice (Bitcoin)">
                <NativeFeeToggle checked={on} onChange={setOn} coinTicker="BTC" />
            </LiveExample>
            <LiveExample label="No choice (mandatory)">
                <NativeFeeToggle checked onChange={noop} coinTicker="LTC" mandatory />
            </LiveExample>
        </Section>
    );
}
