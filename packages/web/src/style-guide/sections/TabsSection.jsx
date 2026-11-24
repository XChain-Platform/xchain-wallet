// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import { Tabs } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function TabsSection() {
    const [homeTab, setHomeTab] = useState('balances');
    const [tokenTab, setTokenTab] = useState('actions');
    const [optionalTab, setOptionalTab] = useState('all');
    return (
        <Section
            id="tabs"
            title="Tabs (page-level)"
            tag="CANONICAL view-toggle tab strip"
            kicker="A full-width segmented tab strip with a filled active segment, used as the primary navigation inside a routed panel (Home's Balances / NFTs / DeFi, TokenDetail's Actions / Details / History). Same look as the Segmented control; it differs in role=&quot;tablist&quot;, panel wiring and optional icons and counts."
        >
            <Guidance
                what={<>A segmented row that spans its container (44px high, <code>--xc-border-strong</code> outline, <code>--xc-card-radius</code>). The active tab fills its segment with <code>--xc-control-selected</code>. An optional count pill sits on the right (muted fill, inverted on the active fill). An optional icon draws before the label.</>}
                when={<>Inside a routed panel where the user is switching VIEWS of the same record (Token detail's tabs over one token) or VIEWS of a related collection (Home tabs over the wallet). Tabs live at the top of the panel content, NOT in the PageHeader.</>}
                whenNot={<>For mutually-exclusive inline filters (All / Coins / Tokens) → use the <a href="#pill-segmented">pill segmented selector</a> instead. For deep navigation (different sections of the app) → use the left-nav / pancake-menu, not tabs.</>}
                sizing={<>The row is 44px high in every shell. Each tab has <code>var(--xc-space-3)</code> inline padding and an optional 11px count pill. The row scrolls horizontally without a scrollbar when labels exceed the width.</>}
                variants={<>Each item may carry <code>icon</code> (16px, before the label), <code>count</code>, and <code>controls</code> (its own panel id); <code>panelId</code> may be a function of the item.</>}
                doRule={<>✓ Use this for primary panel-internal navigation · keep labels short (one or two words) · connect each tab to its panel with <code>panelId</code> · include counts when useful · preserve the built-in arrow, Home, and End keyboard behavior</>}
                dontRule={<>✗ Use tabs as filters that exclude data (filters belong in the pill-segmented or the chip-filter row) · nest tabs inside tabs (use sub-tabs sparingly via the pill-segmented in a tab panel) · restyle the active tab per route (the filled segment is the shared look)</>}
                supersedes={<>Route-local tab button markup and tab styles. Use the shared <code>&lt;Tabs&gt;</code> component for new page-level tab bars.</>}
            />

            <Markup>
{`<Tabs
    id="wallet-tabs"
    items={ITEMS}
    value={active}
    onChange={setActive}
    panelId="wallet-tab-panel"
    aria-label="Wallet view"
/>
<div
    id="wallet-tab-panel"
    role="tabpanel"
    aria-labelledby={\`wallet-tabs-tab-\${active}\`}
>
    {PANELS[active]}
</div>`}
            </Markup>

            <LiveExample label="Home tabs">
                <Tabs
                    id="style-guide-home-tabs"
                    value={homeTab}
                    onChange={setHomeTab}
                    panelId="style-guide-home-panel"
                    aria-label="Home views"
                    items={[
                        { id: 'balances', label: 'Balances' },
                        { id: 'nfts', label: 'NFTs' },
                        { id: 'defi', label: 'DeFi' },
                    ]}
                />
                <div
                    id="style-guide-home-panel"
                    role="tabpanel"
                    aria-labelledby={`style-guide-home-tabs-tab-${homeTab}`}
                >
                    {homeTab === 'balances'
                        ? 'Wallet balances'
                        : homeTab === 'nfts' ? 'Wallet NFTs' : 'DeFi positions'}
                </div>
            </LiveExample>

            <LiveExample label="Token detail">
                <Tabs
                    id="style-guide-token-tabs"
                    value={tokenTab}
                    onChange={setTokenTab}
                    panelId="style-guide-token-panel"
                    aria-label="Token detail views"
                    items={[
                        { id: 'actions', label: 'Actions' },
                        { id: 'details', label: 'Details' },
                        { id: 'history', label: 'History' },
                    ]}
                />
                <div
                    id="style-guide-token-panel"
                    role="tabpanel"
                    aria-labelledby={`style-guide-token-tabs-tab-${tokenTab}`}
                >
                    {tokenTab === 'actions'
                        ? 'Token actions'
                        : tokenTab === 'details' ? 'Token details' : 'Token history'}
                </div>
            </LiveExample>

            <LiveExample label="Counts and icons are optional">
                <Tabs
                    id="style-guide-optional-tabs"
                    value={optionalTab}
                    onChange={setOptionalTab}
                    panelId="style-guide-optional-panel"
                    aria-label="Counts and icons"
                    items={[
                        { id: 'all', label: 'All', count: 12, icon: <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4h10M3 8h10M3 12h10" /></svg> },
                        { id: 'open', label: 'Open', count: 3 },
                        { id: 'done', label: 'Done' },
                    ]}
                />
                <div
                    id="style-guide-optional-panel"
                    role="tabpanel"
                    aria-labelledby={`style-guide-optional-tabs-tab-${optionalTab}`}
                >
                    {optionalTab === 'all' ? 'Every item' : optionalTab === 'open' ? 'Open items' : 'Finished items'}
                </div>
            </LiveExample>
        </Section>
    );
}
