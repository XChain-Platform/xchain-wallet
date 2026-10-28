// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { SegmentedControl } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function PillSegmentedSection() {
    const [kind, setKind] = useState('all');
    const [tab, setTab] = useState('info');
    return (
        <Section
            id="pill-segmented"
            title="Segmented control: inline filter"
            tag="CANONICAL SegmentedControl, short options"
            kicker="The inline exclusive filter and the sub-tab strip are the SegmentedControl component, not a route's own pill."
        >
            <Guidance
                what={<><code>&lt;SegmentedControl items value onChange /&gt;</code> with two to four short labels. See the Segmented control section for its states.</>}
                when={<>An inline filter above a list (All, Coins, Tokens) or a sub-tab strip inside a panel.</>}
                whenNot={<>More than four options (Select) · page-level tabs (Tabs).</>}
                doRule={<>✓ Keep the labels short enough for one line at 360px</>}
                dontRule={<>✗ Draw a route-local pill from native buttons</>}
                supersedes={<>The route-local pill copy this section used to show.</>}
            />
            <Markup>
{`<SegmentedControl items={[{ id: 'all', label: 'All' }, { id: 'coins', label: 'Coins' }]} value={kind} onChange={setKind} />`}
            </Markup>
            <LiveExample label="Three-option inline filter">
                <SegmentedControl aria-label="Kind" value={kind} onChange={setKind} items={[{ id: 'all', label: 'All' }, { id: 'coins', label: 'Coins' }, { id: 'tokens', label: 'Tokens' }]} />
            </LiveExample>
            <LiveExample label="Two-option sub-tab strip">
                <SegmentedControl aria-label="Section" value={tab} onChange={setTab} items={[{ id: 'info', label: 'Info' }, { id: 'media', label: 'Media' }]} />
            </LiveExample>
        </Section>
    );
}
