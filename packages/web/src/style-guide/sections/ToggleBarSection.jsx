// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { SegmentedControl } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function ToggleBarSection() {
    const [source, setSource] = useState('all');
    return (
        <Section
            id="toggle-bar"
            title="Segmented control: full-width filter"
            tag="CANONICAL SegmentedControl, list filter"
            kicker="The list source filter (Addresses: All, Normal, Imported, Misc) is the same SegmentedControl, stretched to the content width."
        >
            <Guidance
                what={<>A <code>SegmentedControl</code> given a class that makes it fill its row. The segments share the width equally.</>}
                when={<>A source or status filter directly above a list.</>}
                whenNot={<>A filter with many options (Select).</>}
                doRule={<>✓ Put it under the search field, above the list</>}
                dontRule={<>✗ Draw white segments with no outline of their own</>}
                supersedes={<>The route-local toggle bar copy this section used to show.</>}
            />
            <Markup>
{`<SegmentedControl style={{ width: '100%' }} items={items} value={source} onChange={setSource} />`}
            </Markup>
            <LiveExample label="Four-option list filter">
                <SegmentedControl aria-label="Source" style={{ width: '100%' }} value={source} onChange={setSource} items={[{ id: 'all', label: 'All' }, { id: 'normal', label: 'Normal' }, { id: 'imported', label: 'Imported' }, { id: 'misc', label: 'Misc' }]} />
            </LiveExample>
        </Section>
    );
}
