// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Sparkline } from '@xchain-wallet/core/shared/components/Sparkline.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const TREND_UP = [10, 11, 10.5, 12, 13, 12.5, 14, 15, 14.2, 16];
const TREND_DOWN = [16, 15, 15.5, 14, 13, 13.4, 12, 11, 11.6, 10];

export function SparklineSection() {
    return (
        <Section
            id="sparkline"
            title="Sparkline"
            tag="CANONICAL · Sparkline"
            kicker="A small price trend line for one token, drawn from a plain list of numbers."
        >
            <Guidance
                what={<><code>Sparkline</code> draws <code>series</code> as an SVG line with an optional area fill. It carries an accessible label and range description.</>}
                when={<>Token detail, the Markets lists and detail, stake detail, and behind the Home portfolio chart.</>}
                whenNot={<>The wallet total, which has range tabs (PortfolioChart).</>}
                sizing={<>Height 80 by default; <code>edgeToEdge</code> runs the line to both edges of its container.</>}
                doRule={<>✓ Pass <code>label</code> and <code>rangeLabel</code> so a screen reader hears the trend</>}
                dontRule={<>✗ Invent a series for a real wallet that has no history</>}
                supersedes={<>Source: <code>Sparkline.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<Sparkline series={prices} height={80} rangeLabel="Last 24 hours" />
<Sparkline series={prices} edgeToEdge />`}
            </Markup>
            <LiveExample label="Rising and falling series, then edge to edge">
                <Sparkline series={TREND_UP} rangeLabel="Last 24 hours" />
                <Sparkline series={TREND_DOWN} rangeLabel="Last 24 hours" />
                <Sparkline series={TREND_UP} edgeToEdge height={48} />
            </LiveExample>
        </Section>
    );
}
