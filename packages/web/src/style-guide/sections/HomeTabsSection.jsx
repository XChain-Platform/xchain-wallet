// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { registry as registryLib } from '@xchain-wallet/core';
import { HomeTabs } from '@xchain-wallet/core/shared/components/HomeTabs.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { RAW_BALANCES } from './sharedComponentExamples.jsx';
import { PartsExampleProvider, PART_WALLET_ID } from './partsExamples.jsx';

const noop = () => {};
const chainRegistry = registryLib.defaultRegistry();
const COIN_FAMILIES = ['bitcoin', 'litecoin', 'dogecoin'];
// A fixed instant so the relative time reads the same on every visit.
// Regtest chains carry no fiat rate, so the guide never asks a price service
// for one.
const HOME_BALANCES = Object.freeze(Object.fromEntries(
    Object.entries(RAW_BALANCES).map(([chainId, rows]) => [chainId.replace('-mainnet', '-regtest'), rows]),
));

export function HomeTabsSection() {
    const [networkFilter, setNetworkFilter] = useState('all');
    const [tokenQuery, setTokenQuery] = useState('');
    return (
        <Section
            id="home-tabs"
            title="Home tabs"
            tag="CANONICAL · HomeTabs"
            kicker="The Balances, NFTs and DeFi tabs over one filter row. Balances is narrowed by Type (All, Coins, Tokens)."
        >
            <Guidance
                what={<><code>HomeTabs</code> builds the balance rows from the raw balances, sorts them, and renders the tab strip, the optional search and network filter, the lists and their empty states.</>}
                when={<>Home only.</>}
                whenNot={<>Other balance lists: use BalanceList directly.</>}
                doRule={<>✓ Pass <code>balanceNoticeShown</code> and <code>recentActivityFailed</code> / <code>defiPositionsFailed</code> so an unreachable network does not read as an empty wallet</>}
                dontRule={<>✗ Add a tab without a plan for its empty state</>}
                supersedes={<>Source: <code>HomeTabs.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<HomeTabs chainRegistry={registry} balances={balances} walletId={walletId} networkFilter="all" coinFamilies={families} />`}
            </Markup>
            <LiveExample label="Balances tab with example balances">
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
