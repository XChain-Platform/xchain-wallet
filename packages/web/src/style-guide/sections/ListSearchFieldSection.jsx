// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ListSearchField } from '@xchain-wallet/core/shared/components/ListSearchField.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function ListSearchFieldSection() {
    const [query, setQuery] = useState('');
    return (
        <Section
            id="list-search-field"
            title="List search field"
            tag="CANONICAL · ListSearchField"
            kicker="No screen uses it; list pages use ListFilterMenu."
        >
            <Guidance
                what={<><code>ListSearchField</code> is a controlled search <code>Input</code> with a leading search icon. <code>label</code> is its accessible name and falls back to the placeholder.</>}
                when={<>The first control inside a <code>ListFilterPopover</code> panel.</>}
                whenNot={<>A search row drawn in the page body (the filter panel holds it) and form fields.</>}
                doRule={<>✓ Give it a label that names what is searched ("Search conversations") · keep the placeholder to one word</>}
                dontRule={<>✗ Add a second clear button · draw a raw input with its own icon</>}
                supersedes={<>Source: <code>ListSearchField.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<ListSearchField value={query} onChange={setQuery} placeholder="Search" label="Search conversations" />`}
            </Markup>
            <LiveExample label="Empty, then typed into">
                <ListSearchField value={query} onChange={setQuery} placeholder="Search" label="Search conversations" />
            </LiveExample>
        </Section>
    );
}
