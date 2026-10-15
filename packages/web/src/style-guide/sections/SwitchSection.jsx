// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Switch } from '@xchain-wallet/core/ui';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

const stack = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-3)',
};

function InteractiveSwitch() {
    const [checked, setChecked] = useState(false);
    return (
        <Switch
            label="Hide small balances"
            description="Collapse balances below your selected threshold."
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
        />
    );
}

export function SwitchSection() {
    return (
        <Section
            id="switch"
            title="Switch"
            tag="CANONICAL · Switch"
            kicker="An immediate on/off setting with consistent semantics, geometry, and touch behavior."
        >
            <Guidance
                what={<>A controlled native checkbox with <code>role="switch"</code>, a visible label, and an optional linked description.</>}
                when={<>Use for an independent setting that takes effect as soon as it changes.</>}
                whenNot={<>Use <a href="#segmented-control">SegmentedControl</a> for mutually exclusive choices, <code>ChoiceControl</code> for form selections, or <code>Button</code> for an action.</>}
                sizing={<>The track and thumb derive from the shared control scale. The complete labeled target is at least 44px high.</>}
                variants={<>Off, on, and disabled. Theme colors come from shared control tokens.</>}
                doRule={<>Give every switch a concise visible label and explain consequences in the description.</>}
                dontRule={<>Do not use a switch when a separate Save action is required or substitute a pressed button for an on/off setting.</>}
            />
            <Markup>
{`<Switch
    label="Hide small balances"
    description="Collapse balances below your selected threshold."
    checked={hideSmallBalances}
    onChange={(event) => setHideSmallBalances(event.target.checked)}
/>`}
            </Markup>
            <LiveExample label="Interactive setting">
                <InteractiveSwitch />
            </LiveExample>
            <LiveExample label="On and disabled states">
                <div style={stack}>
                    <Switch label="Price alerts" checked onChange={() => {}} />
                    <Switch label="Unavailable setting" description="This setting cannot be changed." checked={false} disabled onChange={() => {}} />
                </div>
            </LiveExample>
        </Section>
    );
}
