// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { registry as registryLib } from '@xchain-wallet/core';
import { Button, Icon, PageHeader, Select } from '@xchain-wallet/core/ui';
import { ListFilterMenu } from '@xchain-wallet/core/shared/components/ListFilterMenu.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const noop = () => {};
const chainRegistry = registryLib.defaultRegistry();
const COIN_FAMILIES = ['bitcoin', 'litecoin', 'dogecoin'];

export function ListFilterMenuSection() {
    const [query, setQuery] = useState('');
    const [network, setNetwork] = useState('all');
    const [status, setStatus] = useState('all');
    return (
        <Section
            id="list-filter-menu"
            title="List filter menu"
            tag="CANONICAL · ListFilterMenu"
            kicker="List pages keep search and filters in the title bar: one filter icon opens a panel, and a plus icon beside it creates a new item."
        >
            <Guidance
                what={<><code>ListFilterMenu</code> is a filter icon for a page header's <code>trailing</code> slot. Its panel holds the search box first, then the network picker (when given a registry and coin families), then the page's own pickers as children. A blue dot on the icon says a filter is narrowing the list.</>}
                when={<>A list page: contacts, dispensers, contracts, feeds. The page body is then only the list.</>}
                whenNot={<>A short list with nothing to narrow, and forms.</>}
                sizing={<>The icon and the plus icon are the same secondary icon button size, side by side in the title bar.</>}
                doRule={<>✓ Pass <code>active</code> when a child filter is off its default · put the New action beside it as a plain plus icon with an accessible name</>}
                dontRule={<>✗ Draw a search box or filter row in the page body · give the plus icon a visible text label</>}
                supersedes={<>Source: <code>ListFilterMenu.jsx</code> in <code>shared/components</code>. Reference page: <code>DispensersList.jsx</code>.</>}
            />
            <Markup>
{`<PageHeader onBack={back} title="My Dispensers" trailing={(
    <>
        <ListFilterMenu query={query} onQueryChange={setQuery} searchPlaceholder="Search" searchLabel="Search dispensers"
            active={status !== 'all'} label="Filter dispensers"
            chainRegistry={registry} coinFamilies={families} networkFilter={network} onNetworkFilterChange={setNetwork}>
            <Select label="Status" size="md" ...>...</Select>
        </ListFilterMenu>
        <Button variant="secondary" icon={<Icon.PlusIcon />} aria-label="New dispenser" title="New dispenser" onClick={create}>{null}</Button>
    </>
)} />`}
            </Markup>
            <LiveExample label="Title bar with the filter icon and the plus icon" padded={false}>
                <PageHeader
                    onBack={noop}
                    title="My Dispensers"
                    trailing={(
                        <>
                            <ListFilterMenu
                                query={query}
                                onQueryChange={setQuery}
                                active={status !== 'all'}
                                label="Filter dispensers"
                                searchPlaceholder="Search"
                                searchLabel="Search dispensers"
                                chainRegistry={chainRegistry}
                                coinFamilies={COIN_FAMILIES}
                                networkFilter={network}
                                onNetworkFilterChange={setNetwork}
                            >
                                <Select label="Status" size="md" value={status} onChange={(event) => setStatus(event.target.value)}>
                                    <option value="all">All</option>
                                    <option value="open">Open</option>
                                    <option value="soldout">Sold out</option>
                                </Select>
                            </ListFilterMenu>
                            <Button variant="secondary" icon={<Icon.PlusIcon />} aria-label="New dispenser" title="New dispenser" onClick={noop}>
                                {null}
                            </Button>
                        </>
                    )}
                />
            </LiveExample>
        </Section>
    );
}
