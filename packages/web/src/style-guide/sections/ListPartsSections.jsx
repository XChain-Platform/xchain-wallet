// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The list filter parts and the list and expiration fields that several
// routes now share: the search box and filter panel a list page's header
// opens, the list selector the trade forms use for allow and block lists, and
// the Expiration choice on the trade forms' terms.

import { useState } from 'react';
import { Button, Icon, Input, PageHeader, Select } from '@xchain-wallet/core/ui';
import { ListSearchField } from '@xchain-wallet/core/shared/components/ListSearchField.jsx';
import { ListFilterPopover } from '@xchain-wallet/core/shared/components/ListFilterPopover.jsx';
import { ListField } from '@xchain-wallet/core/shared/components/ListField.jsx';
import { EXPIRATION_OPTIONS } from '@xchain-wallet/core/shared/components/expirationChoice.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const noop = () => {};

const STATUS_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'settled', label: 'Settled' },
];

export function ListSearchFieldSection() {
    const [query, setQuery] = useState('');
    return (
        <Section
            id="list-search-field"
            title="List search field"
            tag="CANONICAL · ListSearchField"
            kicker="The search box every list filter panel opens with: a search icon, the kit Input and the browser's own clear control."
        >
            <Guidance
                what={<><code>ListSearchField</code> is a controlled search <code>Input</code> with a leading search icon. <code>label</code> is its accessible name and falls back to the placeholder.</>}
                when={<>The first control inside a <code>ListFilterPopover</code> panel: conversations, messages in a thread, payments due, notifications.</>}
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

export function ListFilterPopoverSection() {
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('all');
    const active = query.trim() !== '' || status !== 'all';
    return (
        <Section
            id="list-filter-popover"
            title="List filter popover"
            tag="CANONICAL · ListFilterPopover"
            kicker="One filter icon in the title bar that opens a panel of the page's own list controls, the same trigger and panel Home uses."
        >
            <Guidance
                what={<><code>ListFilterPopover</code> owns only the open state, outside-click and Escape handling and the dot that says a filter is applied. The host owns the filter values and passes the controls as children, a <code>ListSearchField</code> first.</>}
                when={<>A list page whose controls are not the standard set <code>ListFilterMenu</code> draws: the inbox, a message thread, payments due, notifications and the dispenser explorer.</>}
                whenNot={<>A page that needs only search plus the network picker (use <code>ListFilterMenu</code>) and forms.</>}
                sizing={<><code>size="sm"</code> matches the other icon buttons in a page header's <code>trailing</code> slot; <code>md</code> is for a toolbar row.</>}
                doRule={<>✓ Pass <code>active</code> whenever a control is off its default · put the search field first</>}
                dontRule={<>✗ Show the filter controls in the page body as well · give the trigger a visible text label</>}
                supersedes={<>Source: <code>ListFilterPopover.jsx</code> in <code>shared/components</code>. Reference page: <code>MessagingInbox.jsx</code>.</>}
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

export function ExpirationChoiceSection() {
    const [mode, setMode] = useState('default');
    const [expires, setExpires] = useState('');
    return (
        <Section
            id="expiration-choice"
            title="Expiration choice"
            tag="CANONICAL · EXPIRATION_OPTIONS"
            kicker="The Expiration choice on the trade forms' terms: the standard icon dropdown with an icon per option (G44), never radio buttons."
        >
            <Guidance
                what={<><code>EXPIRATION_OPTIONS</code> from <code>expirationChoice.jsx</code> is the shared option list (Default window, Expire at a specific time) for the kit <code>Select</code>. Choosing <code>custom</code> shows the form's own Expires date and time field under it.</>}
                when={<>The terms of Swap, Create Order, Cross-Chain Swap and Cross-Chain Order, and the dispenser form's expiry.</>}
                whenNot={<>An expiry with other choices: give that field its own options.</>}
                doRule={<>✓ Import the shared options so every trade form reads alike · show the Expires field only for <code>custom</code></>}
                dontRule={<>✗ Copy the options into a route · draw the choice as radio buttons</>}
                supersedes={<>Source: <code>expirationChoice.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<Select label="Expiration" value={expMode} onChange={(e) => setExpMode(e.target.value)} options={EXPIRATION_OPTIONS} />
{expMode === 'custom' ? <Input label="Expires" type="datetime-local" value={expInput} onChange={...} /> : null}`}
            </Markup>
            <LiveExample label="Default window, then a specific time">
                <div style={{ display: 'grid', gap: 'var(--xc-form-gap)' }}>
                    <Select
                        label="Expiration"
                        help="How long the order stays open for matching."
                        value={mode}
                        onChange={(event) => setMode(event.target.value)}
                        options={EXPIRATION_OPTIONS}
                    />
                    {mode === 'custom' ? (
                        <Input
                            label="Expires"
                            type="datetime-local"
                            value={expires}
                            onChange={(event) => setExpires(event.target.value)}
                        />
                    ) : null}
                </div>
            </LiveExample>
        </Section>
    );
}
