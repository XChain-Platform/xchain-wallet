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
    const [tokenTab, setTokenTab] = useState('info');
    return (
        <Section
            id="tabs"
            title="Tabs (page-level)"
            tag="CANONICAL underline tab strip"
            kicker="Larger, bolder tabs with an accent-colored active state, used as the primary navigation inside a routed panel (Home's Balances / Activity / DeFi, TokenDetail's Info / Market / Holders). Distinct from the pill-segmented selector, which is for inline filters."
        >
            <Guidance
                what={<>A horizontal row of transparent buttons; the active tab gets <code>color: var(--xc-accent-text)</code> and a 2px accent underline. Optional count badge on the right of each label: accent-tinted gray by default, inverted to accent-primary background with white text when the tab is active.</>}
                when={<>Inside a routed panel where the user is switching VIEWS of the same record (Token detail's tabs over one token) or VIEWS of a related collection (Home tabs over the wallet). Tabs live at the top of the panel content, NOT in the PageHeader.</>}
                whenNot={<>For mutually-exclusive inline filters (All / Coins / Tokens) → use the <a href="#pill-segmented">pill segmented selector</a> instead. For deep navigation (different sections of the app) → use the left-nav / pancake-menu, not tabs.</>}
                sizing={<>The row uses <code>var(--xc-control-h-md)</code>. Each tab has <code>var(--xc-space-3)</code> inline padding, a 2px accent underline when selected, and an optional 11px count badge. The row scrolls horizontally without showing a scrollbar when labels exceed the available width.</>}
                doRule={<>✓ Use this for primary panel-internal navigation · keep labels short (one or two words) · connect each tab to its panel with <code>panelId</code> · include counts when useful · preserve the built-in arrow, Home, and End keyboard behavior</>}
                dontRule={<>✗ Use tabs as filters that exclude data (filters belong in the pill-segmented or the chip-filter row) · nest tabs inside tabs (use sub-tabs sparingly via the pill-segmented in a tab panel) · drop the underline in favor of a background fill (the underline is the visual signature)</>}
                supersedes={<>Route-local tab button markup and underline styles. Use the shared <code>&lt;Tabs&gt;</code> component for new page-level tab bars.</>}
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

            <LiveExample label="Home tabs (with count badges)">
                <Tabs
                    id="style-guide-home-tabs"
                    value={homeTab}
                    onChange={setHomeTab}
                    panelId="style-guide-home-panel"
                    aria-label="Home views"
                    items={[
                        { id: 'balances', label: 'Balances', count: 12 },
                        { id: 'activity', label: 'Activity', count: 3 },
                        { id: 'defi', label: 'DeFi', count: 0 },
                    ]}
                />
                <div
                    id="style-guide-home-panel"
                    role="tabpanel"
                    aria-labelledby={`style-guide-home-tabs-tab-${homeTab}`}
                >
                    {homeTab === 'balances'
                        ? 'Wallet balances'
                        : homeTab === 'activity' ? 'Wallet activity' : 'DeFi positions'}
                </div>
            </LiveExample>

            <LiveExample label="Token detail (no counts)">
                <Tabs
                    id="style-guide-token-tabs"
                    value={tokenTab}
                    onChange={setTokenTab}
                    panelId="style-guide-token-panel"
                    aria-label="Token detail views"
                    items={[
                        { id: 'info', label: 'Info' },
                        { id: 'market', label: 'Market' },
                        { id: 'holders', label: 'Holders' },
                    ]}
                />
                <div
                    id="style-guide-token-panel"
                    role="tabpanel"
                    aria-labelledby={`style-guide-token-tabs-tab-${tokenTab}`}
                >
                    {tokenTab === 'info'
                        ? 'Token information'
                        : tokenTab === 'market' ? 'Market data' : 'Token holders'}
                </div>
            </LiveExample>
        </Section>
    );
}
