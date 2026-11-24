// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Select } from '@xchain-wallet/core/ui';
import { ListToolbar } from '@xchain-wallet/core/shared/components/ListToolbar.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function ListToolbarSection() {
    const [query, setQuery] = useState('');
    const [kind, setKind] = useState('all');
    return (
        <Section
            id="list-toolbar"
            title="List toolbar"
            tag="CANONICAL · ListToolbar"
            kicker="Legacy: no screen uses it. List pages put search and filters in ListFilterMenu in the title bar."
        >
            <Guidance
                what={<><code>&lt;ListToolbar query onQueryChange searchLabel&gt;</code> renders a search <code>Input</code> and wraps each child (a Select, a SegmentedControl) in an equal field cell.</>}
                when={<>Do not use for new pages.</>}
                whenNot={<>Forms: they take FormSection fields, not a toolbar.</>}
                doRule={<>✓ Pass filters as children so they share the row</>}
                dontRule={<>✗ Draw a second search input beside the toolbar</>}
                supersedes={<>Source: <code>ListToolbar.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<ListToolbar query={query} onQueryChange={setQuery} searchLabel="Search contacts">
    <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>...</Select>
</ListToolbar>`}
            </Markup>
            <LiveExample label="Search and one filter">
                <ListToolbar query={query} onQueryChange={setQuery} searchLabel="Search the list">
                    <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                        <option value="all">All</option>
                        <option value="mine">Mine</option>
                    </Select>
                </ListToolbar>
            </LiveExample>
        </Section>
    );
}
