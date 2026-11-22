// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { PortfolioChart } from '@xchain-wallet/core/shared/components/PortfolioChart.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { SAMPLE_BALANCE_ROWS, SharedComponentExampleProvider } from './sharedComponentExamples.jsx';

export function PortfolioChartSection() {
    return (
        <Section
            id="portfolio-chart"
            title="Portfolio chart"
            tag="CANONICAL · PortfolioChart"
            kicker="Home's performance chart: the wallet's total fiat value over a chosen range, drawn on the brand card."
        >
            <Guidance
                what={<><code>PortfolioChart</code> sums each balance row's fiat value into one series for the selected range, with range tabs and a change readout. Its series always ends at the portfolio total, so it agrees with the balance hero.</>}
                when={<>Home, under the total balance.</>}
                whenNot={<>One token's price history (Sparkline).</>}
                doRule={<>✓ Pass rows already filtered by network · let the user hide it from settings</>}
                dontRule={<>✗ Fetch prices inside the chart's parent on every render</>}
                supersedes={<>Source: <code>PortfolioChart.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<PortfolioChart rows={rows} walletId={walletId} nativePriceMap={prices} onRangeChange={setRange} />`}
            </Markup>
            <LiveExample label="Three sample balances">
                <SharedComponentExampleProvider>
                    <PortfolioChart rows={SAMPLE_BALANCE_ROWS} walletId="wallet-example" />
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}
