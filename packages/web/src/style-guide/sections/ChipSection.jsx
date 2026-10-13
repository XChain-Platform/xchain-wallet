// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Chip } from '@xchain-wallet/core/ui';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

const row = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--xc-space-2)',
    alignItems: 'center',
};

function ToggleChipExample() {
    const [selected, setSelected] = useState('week');
    return (
        <div style={row} role="group" aria-label="History range">
            <Chip pressed={selected === 'week'} onPressedChange={() => setSelected('week')}>7 days</Chip>
            <Chip pressed={selected === 'month'} onPressedChange={() => setSelected('month')}>30 days</Chip>
            <Chip pressed={selected === 'all'} onPressedChange={() => setSelected('all')}>All</Chip>
        </div>
    );
}

export function ChipSection() {
    return (
        <Section
            id="chip"
            title="Chip"
            tag="CANONICAL · Chip"
            kicker="A compact pill for filter choices and short, static metadata. Toggle chips expose their state through aria-pressed."
        >
            <Guidance
                what={<>Pass boolean <code>pressed</code> and <code>onPressedChange</code> for a toggle button. Omit <code>pressed</code> for a static <code>&lt;span&gt;</code>.</>}
                when={<>Use toggle chips for compact filters or presets, and static chips for short metadata such as a market pair.</>}
                whenNot={<>Use <code>Button</code> for actions, a checkbox for independent form choices, and a segmented selector for one persistent view mode.</>}
                sizing={<>Every chip uses <code>--xc-control-h-sm</code>, pill radius, one-line labels, and shared horizontal padding.</>}
                variants={<>Static, toggle off, toggle on, and disabled toggle.</>}
                doRule={<>Keep labels brief and wrap a related toggle set in a named group.</>}
                dontRule={<>Do not use a static chip as an action or encode toggle state through color alone.</>}
            />
            <Markup>
{`<Chip pressed={selected} onPressedChange={setSelected}>Watchlist</Chip>
<Chip>BTC / LTC</Chip>`}
            </Markup>
            <LiveExample label="History date presets">
                <ToggleChipExample />
            </LiveExample>
            <LiveExample label="Static and disabled states">
                <div style={row}>
                    <Chip>BTC / LTC</Chip>
                    <Chip pressed={false} onPressedChange={() => {}} disabled>Unavailable</Chip>
                </div>
            </LiveExample>
        </Section>
    );
}
