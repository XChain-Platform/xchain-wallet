// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Button, Icon, PageHeader, Select } from '@xchain-wallet/core/ui';
import { ListSearchField } from '@xchain-wallet/core/shared/components/ListSearchField.jsx';
import { ListFilterPopover } from '@xchain-wallet/core/shared/components/ListFilterPopover.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const noop = () => {};

const STATUS_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'settled', label: 'Settled' },
];

export function ListFilterPopoverSection() {
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('all');
    const active = query.trim() !== '' || status !== 'all';
    return (
        <Section
            id="list-filter-popover"
            title="List filter popover"
            tag="CANONICAL · ListFilterPopover"
            kicker="No screen uses it; list pages use ListFilterMenu."
        >
            <Guidance
                what={<><code>ListFilterPopover</code> owns only the open state, outside-click and Escape handling and the dot that says a filter is applied. The host owns the filter values and passes the controls as children, a <code>ListSearchField</code> first.</>}
                when={<>Only a list page whose controls are not the standard set <code>ListFilterMenu</code> draws.</>}
                whenNot={<>A page that needs only search plus the network picker (use <code>ListFilterMenu</code>) and forms.</>}
                sizing={<><code>size="sm"</code> matches the other icon buttons in a page header's <code>trailing</code> slot; <code>md</code> is for a toolbar row.</>}
                doRule={<>✓ Pass <code>active</code> whenever a control is off its default · put the search field first</>}
                dontRule={<>✗ Show the filter controls in the page body as well · give the trigger a visible text label</>}
                supersedes={<>Source: <code>ListFilterPopover.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<PageHeader onBack={back} title="Payments Due" trailing={(
    <ListFilterPopover label="Filter payments" active={query.trim() !== '' || status !== 'all'} size="sm">
        <ListSearchField value={query} onChange={setQuery} placeholder="Search" label="Search payments" />
        <Select label="Status" size="md" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} />
    </ListFilterPopover>
)} />`}
            </Markup>
            <LiveExample label="Title bar with the filter icon; open it to see the panel" padded={false}>
                <PageHeader
                    onBack={noop}
                    title="Payments Due"
                    trailing={(
                        <>
                            <ListFilterPopover label="Filter payments" active={active} size="sm">
                                <ListSearchField value={query} onChange={setQuery} placeholder="Search" label="Search payments" />
                                <Select
                                    label="Status"
                                    size="md"
                                    value={status}
                                    onChange={(event) => setStatus(event.target.value)}
                                    options={STATUS_OPTIONS}
                                />
                            </ListFilterPopover>
                            <Button variant="secondary" size="sm" icon={<Icon.PlusIcon />} aria-label="New order" title="New order" onClick={noop}>
                                {null}
                            </Button>
                        </>
                    )}
                />
            </LiveExample>
        </Section>
    );
}
