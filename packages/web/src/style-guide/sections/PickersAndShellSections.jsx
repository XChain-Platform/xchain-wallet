// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { registry as registryLib } from '@xchain-wallet/core';
import { Select } from '@xchain-wallet/core/ui';
import { OwnAddressPickerScreen } from '@xchain-wallet/core/shared/components/OwnAddressPickerScreen.jsx';
import { ListPickerScreen } from '@xchain-wallet/core/shared/components/ListPickerScreen.jsx';
import { ListToolbar } from '@xchain-wallet/core/shared/components/ListToolbar.jsx';
import { OfflineEmptyState } from '@xchain-wallet/core/shared/components/OfflineEmptyState.jsx';
import { BalancesUncheckedState } from '@xchain-wallet/core/shared/components/BalancesUncheckedState.jsx';
import { RelativeTime } from '@xchain-wallet/core/shared/components/RelativeTime.jsx';
import { ActivityRow } from '@xchain-wallet/core/shared/components/ActivityRow.jsx';
import { EntryRow } from '@xchain-wallet/core/shared/routes/HistoryEntryRow.jsx';
import { HomeTabs } from '@xchain-wallet/core/shared/components/HomeTabs.jsx';
import { LeftNav } from '@xchain-wallet/core/shared/components/LeftNav.jsx';
import { BottomTabBar } from '@xchain-wallet/core/shared/components/BottomTabBar.jsx';
import { HeaderActionMenu } from '@xchain-wallet/core/shared/components/HeaderActionMenu.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { RAW_BALANCES } from './sharedComponentExamples.jsx';
import {
    PartsExampleProvider,
    PART_ACCOUNT_ID,
    PART_ADDRESS,
    PART_CHAIN_ID,
    PART_WALLET_ID,
} from './partsExamples.jsx';

const noop = () => {};
const chainRegistry = registryLib.defaultRegistry();
const COIN_FAMILIES = ['bitcoin', 'litecoin', 'dogecoin'];
// A fixed instant so the relative time reads the same on every visit.
// Regtest chains carry no fiat rate, so the guide never asks a price service
// for one.
const HOME_BALANCES = Object.freeze(Object.fromEntries(
    Object.entries(RAW_BALANCES).map(([chainId, rows]) => [chainId.replace('-mainnet', '-regtest'), rows]),
));
const FIVE_MINUTES_AGO = () => Date.now() - 5 * 60 * 1000;

export function PickerScreensSection() {
    return (
        <Section
            id="picker-screens"
            title="Picker screens"
            tag="CANONICAL · OwnAddressPickerScreen / ListPickerScreen"
            kicker="The full-screen choosers a form opens to fill one field: one of the wallet's own addresses, or one of the token lists an address has published."
        >
            <Guidance
                what={<><code>OwnAddressPickerScreen</code> is the address list in picker mode, filtered to one chain; picking a row returns it and closes. <code>ListPickerScreen</code> loads the lists published from the chosen addresses, narrows them by type, and supports search.</>}
                when={<>A form field that needs one of the wallet's own addresses, or a list reference, and has no room for a dropdown.</>}
                whenNot={<>Choosing among a handful of fixed options (Select or SegmentedControl) · choosing a contact (the contacts picker).</>}
                doRule={<>✓ Return the choice through <code>onSelect</code> / <code>onPick</code> and restore the form's state on Back</>}
                dontRule={<>✗ Embed the chooser inside the form's own scroll area</>}
                supersedes={<>Source: <code>OwnAddressPickerScreen.jsx</code>, <code>ListPickerScreen.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<OwnAddressPickerScreen walletId={walletId} accountId={accountId} chainId={chainId} onPick={pick} onBack={back} />
<ListPickerScreen variant="small" messaging={messaging} chainId={chainId} addresses={addresses} filterType={1} onSelect={pick} onBack={back} />`}
            </Markup>
            <LiveExample label="OwnAddressPickerScreen" minHeight={420} padded={false}>
                <PartsExampleProvider>
                    <OwnAddressPickerScreen
                        walletId={PART_WALLET_ID}
                        accountId={PART_ACCOUNT_ID}
                        chainId={PART_CHAIN_ID}
                        onPick={noop}
                        onBack={noop}
                    />
                </PartsExampleProvider>
            </LiveExample>
            <LiveExample label="ListPickerScreen: no lists published yet" minHeight={320} padded={false}>
                <PartsExampleProvider>
                    <ListPickerScreen
                        variant="small"
                        messaging={{ getListsForSource: async () => ({ lists: [] }) }}
                        chainId={PART_CHAIN_ID}
                        addresses={[{ address: PART_ADDRESS }]}
                        filterType={1}
                        onSelect={noop}
                        onBack={noop}
                    />
                </PartsExampleProvider>
            </LiveExample>
        </Section>
    );
}

export function ListToolbarSection() {
    const [query, setQuery] = useState('');
    const [kind, setKind] = useState('all');
    return (
        <Section
            id="list-toolbar"
            title="List toolbar"
            tag="CANONICAL · ListToolbar"
            kicker="The row above a list: one search field, then any filters, all the same height and spaced by the same gap."
        >
            <Guidance
                what={<><code>&lt;ListToolbar query onQueryChange searchLabel&gt;</code> renders a search <code>Input</code> and wraps each child (a Select, a SegmentedControl) in an equal field cell.</>}
                when={<>Above a list that can be searched or filtered: contacts, dispensers, lists, messages.</>}
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

export function UnavailableStatesSection() {
    return (
        <Section
            id="unavailable-states"
            title="Offline and unchecked states"
            tag="CANONICAL · OfflineEmptyState / BalancesUncheckedState"
            kicker="What an empty screen says when the cause is the connection, not the account: the page could not be loaded offline, or balances could not be checked."
        >
            <Guidance
                what={<>Both render the shared <code>EmptyState</code> with the info icon and a Try again action, and both hide the page-level reachability notice while shown so the message appears once. <code>BalancesUncheckedState</code> adds a Receive action when the screen offers one.</>}
                when={<>A list or detail that has nothing to show because the network is unreachable. Use <code>useBalancesUnchecked</code> to decide when a balance list is unchecked rather than empty.</>}
                whenNot={<>A reachable network with no data: that is the plain EmptyState.</>}
                doRule={<>✓ Pass <code>onRetry</code> so Try again re-runs the load</>}
                dontRule={<>✗ Say "no balances" when the check failed</>}
                supersedes={<>Source: <code>OfflineEmptyState.jsx</code>, <code>BalancesUncheckedState.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<OfflineEmptyState onRetry={reload} body="Reconnect to load this list." />
<BalancesUncheckedState onRetry={recheck} onReceive={openReceive} />`}
            </Markup>
            <LiveExample label="OfflineEmptyState">
                <PartsExampleProvider>
                    <OfflineEmptyState onRetry={noop} body="Reconnect to load this list." />
                </PartsExampleProvider>
            </LiveExample>
            <LiveExample label="BalancesUncheckedState">
                <PartsExampleProvider>
                    <BalancesUncheckedState onRetry={noop} onReceive={noop} />
                </PartsExampleProvider>
            </LiveExample>
        </Section>
    );
}

export function ActivityRowsSection() {
    return (
        <Section
            id="activity-rows"
            title="Activity rows"
            tag="CANONICAL · ActivityRow / HistoryEntryRow / RelativeTime"
            kicker="One row for one thing that happened: the asset mark, what it was, the amount, its status and how long ago. History and the Home activity tab draw it from the same component."
        >
            <Guidance
                what={<><code>ActivityRow</code> is a full-width button of asset mark, label with optional context, amount, status chip and relative time. <code>EntryRow</code> (HistoryEntryRow) maps a history entry onto it. <code>RelativeTime</code> renders the age as a live <code>time</code> element.</>}
                when={<>Any list of past activity.</>}
                whenNot={<>Balances (BalanceList) · people and addresses (ListRow).</>}
                doRule={<>✓ Map every status to its label through <code>statusLabels</code></>}
                dontRule={<>✗ Format the age by hand</>}
                supersedes={<>Source: <code>ActivityRow.jsx</code>, <code>RelativeTime.jsx</code>, <code>routes/HistoryEntryRow.jsx</code>.</>}
            />
            <Markup>
{`<ActivityRow chainId="bitcoin-mainnet" tick="BTC" isNative label="Sent" amount="-0.01 BTC" status="confirmed" timestamp={ts} onClick={open} />`}
            </Markup>
            <LiveExample label="ActivityRow: confirmed and pending">
                <PartsExampleProvider>
                    <ActivityRow chainId={PART_CHAIN_ID} tick="BTC" isNative label="Sent" context="To Savings" amount="-0.01 BTC" status="confirmed" timestamp={FIVE_MINUTES_AGO()} onClick={noop} />
                    <ActivityRow chainId={PART_CHAIN_ID} tick="BTC" isNative label="Received" amount="+0.002 BTC" status="pending" timestamp={FIVE_MINUTES_AGO()} onClick={noop} />
                </PartsExampleProvider>
            </LiveExample>
            <LiveExample label="HistoryEntryRow (EntryRow)">
                <PartsExampleProvider>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        <EntryRow
                            entry={{
                                key: 'example-entry',
                                chainId: PART_CHAIN_ID,
                                action: 'send',
                                txHash: 'ab'.repeat(32),
                                source: PART_ADDRESS,
                                timestamp: FIVE_MINUTES_AGO(),
                                status: 'confirmed',
                                raw: {},
                            }}
                            selected={false}
                            onClick={noop}
                            peerCache={{}}
                            chainTip={0}
                            walletId={PART_WALLET_ID}
                            walletAddresses={new Set([PART_ADDRESS])}
                        />
                    </ul>
                </PartsExampleProvider>
            </LiveExample>
            <LiveExample label="RelativeTime">
                <RelativeTime timestamp={FIVE_MINUTES_AGO()} />
            </LiveExample>
        </Section>
    );
}

export function ShellNavigationSection() {
    const [view, setView] = useState('home');
    const frame = { border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden', position: 'relative' };
    return (
        <Section
            id="shell-navigation"
            title="Navigation"
            tag="CANONICAL · shell"
            kicker="The three ways the shell reaches every screen: the left rail on wide windows, the tab bar with its More sheet on phones, and the header menu that collects the actions a narrow header cannot hold."
        >
            <Guidance
                what={<><code>LeftNav</code> and <code>BottomTabBar</code> take the same <code>currentView</code>, <code>onSelect</code> and capability flags (<code>hasDexSurface</code>, <code>hasVmAddress</code>, <code>isSignerMode</code>), so a destination is present in both or neither. <code>HeaderActionMenu</code> is the overflow menu in the app header.</>}
                when={<>Mounted once by the shell layout, never by a route.</>}
                whenNot={<>In-page navigation: Tabs and SegmentedControl.</>}
                doRule={<>✓ Remove a destination the build lacks instead of disabling it</>}
                dontRule={<>✗ Add a destination to one component and not the other</>}
                supersedes={<>Source: <code>LeftNav.jsx</code>, <code>BottomTabBar.jsx</code>, <code>HeaderActionMenu.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<LeftNav currentView={view} onSelect={setView} onLock={lock} onOpenSettings={openSettings} onCommandPalette={openPalette} />
<BottomTabBar currentView={view} onSelect={setView} onLock={lock} onOpenSettings={openSettings} />
<HeaderActionMenu onScan={scan} onCommandPalette={openPalette} onMore={more} />`}
            </Markup>
            <LiveExample label="LeftNav" minHeight={420} padded={false}>
                <PartsExampleProvider>
                    <div style={{ ...frame, width: 'max-content', maxWidth: '100%' }}>
                        <LeftNav currentView={view} onSelect={setView} onLock={noop} onOpenSettings={noop} onCommandPalette={noop} />
                    </div>
                </PartsExampleProvider>
            </LiveExample>
            <LiveExample label="BottomTabBar" padded={false}>
                <PartsExampleProvider>
                    <div style={{ ...frame, height: 96 }}>
                        <BottomTabBar currentView={view} onSelect={setView} onLock={noop} onOpenSettings={noop} onOpenWalletPicker={noop} onCommandPalette={noop} />
                    </div>
                </PartsExampleProvider>
            </LiveExample>
            <LiveExample label="HeaderActionMenu" minHeight={220}>
                <PartsExampleProvider>
                    <HeaderActionMenu onCommandPalette={noop} onScan={noop} onManageAddresses={noop} onViewAddress={noop} onMore={noop} />
                </PartsExampleProvider>
            </LiveExample>
        </Section>
    );
}

export function HomeTabsSection() {
    const [networkFilter, setNetworkFilter] = useState('all');
    const [tokenQuery, setTokenQuery] = useState('');
    return (
        <Section
            id="home-tabs"
            title="Home tabs"
            tag="CANONICAL · HomeTabs"
            kicker="The Home body below the balance hero: the Coins, Tokens, NFTs, DeFi and Activity tabs over one filter row."
        >
            <Guidance
                what={<><code>HomeTabs</code> builds the balance rows from the raw balances, sorts them, and renders the tab strip, the optional search and network filter, the lists and their empty states. Quick actions go in the <code>actions</code> slot.</>}
                when={<>Home only.</>}
                whenNot={<>Other balance lists: use BalanceList directly.</>}
                doRule={<>✓ Pass <code>balancesUnchecked</code> so an unreachable network does not read as an empty wallet</>}
                dontRule={<>✗ Add a fourth tab without a plan for its empty state</>}
                supersedes={<>Source: <code>HomeTabs.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<HomeTabs chainRegistry={registry} balances={balances} walletId={walletId} networkFilter="all" coinFamilies={families} />`}
            </Markup>
            <LiveExample label="Coins tab with example balances">
                <PartsExampleProvider>
                    <HomeTabs
                        chainRegistry={chainRegistry}
                        balances={HOME_BALANCES}
                        walletId={PART_WALLET_ID}
                        networkFilter={networkFilter}
                        tokenQuery={tokenQuery}
                        coinFamilies={COIN_FAMILIES}
                        onNetworkFilterChange={setNetworkFilter}
                        onTokenQueryChange={setTokenQuery}
                        onSelectToken={noop}
                        onReceive={noop}
                    />
                </PartsExampleProvider>
            </LiveExample>
        </Section>
    );
}
