// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { TotalBalanceHero } from '@xchain-wallet/core/shared/components/TotalBalanceHero.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import {
    SAMPLE_BALANCE_ROWS,
    SharedComponentExampleProvider,
} from './sharedComponentExamples.jsx';

export function AccentBorderedCardSection() {
    return (
        <Section
            id="solid-accent-card"
            title="Hero card (Total Balance)"
            tag="CANONICAL hero / primary-figure card"
            kicker="A bordered hero surface for the one primary figure on a screen. Used for the Total Balance hero at the top of Home."
        >
            <Guidance
                what={<>A card using the <code>--xc-hero-bg</code> fill, <code>--xc-hero-border</code> border, <code>--xc-hero-text</code> text, <code>--xc-card-radius</code>, <code>--xc-card-pad</code> padding and <code>--xc-hero-shadow</code>. A chart sits inside, with range chips (<code>--xc-hero-chip-*</code>) and change pills (<code>--xc-hero-pill-*</code>).</>}
                when={<>The single most important figure on a screen: total balance on Home, a deal-closing summary on a confirmation screen, the "you are here" status on an in-flight transaction. Use ONCE per screen.</>}
                whenNot={<>Default grouping: <a href="#gray-card">card</a>. Highlighted-but-not-primary cards (the portfolio chart wrap, the quick-action tiles): the outlined accent-border variant (Quick-action card pattern). Status callouts (error / warning / success): tinted status colors, not the brand fill.</>}
                sizing={<>Padding <code>--xc-card-pad</code> (8px). Radius <code>--xc-card-radius</code> (8px).</>}
                variants={<>The shared <code>TotalBalanceHero</code> always provides chart and privacy actions. <code>onRefresh</code>, <code>onCommandPalette</code>, <code>onOpenSettings</code>, and <code>onLockWallet</code> add only the actions each shell can perform.</>}
                doRule={<>✓ Use the <code>--xc-hero-*</code> tokens, never a flat brand-blue fill.</>}
                dontRule={<>✗ Never put white text on it.</>}
                supersedes={<>Hand-written copies of the Home balance hero. Use <code>TotalBalanceHero</code> so pricing, privacy, staleness, and shell actions keep the same behavior.</>}
            />

            <Markup>
{`import { TotalBalanceHero } from '@xchain-wallet/core/shared/components/TotalBalanceHero.jsx';

<TotalBalanceHero
    rows={pricedBalanceRows}
    walletId={walletId}
    networkFilter={networkFilter}
    lastSyncedAt={balancesFetchedAt}
    pricesFetchedAt={pricesFetchedAt}
    onRefresh={refreshBalances}
    refreshing={refreshing}
/>`}
            </Markup>

            <LiveExample label="Active-address balance hero with the production actions">
                <SharedComponentExampleProvider>
                    <TotalBalanceHero
                        rows={SAMPLE_BALANCE_ROWS}
                        walletId="style-guide-wallet"
                        networkFilter="all"
                        lastSyncedAt={Date.parse('2026-10-13T09:00:00Z')}
                        pricesFetchedAt={Date.parse('2026-10-13T09:00:00Z')}
                        onRefresh={() => {}}
                    />
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}
