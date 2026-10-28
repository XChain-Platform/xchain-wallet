// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { TickerIcon } from '@xchain-wallet/core/shared/components/TickerIcon.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function StackedAssetIconSection() {
    return (
        <Section
            id="stacked-asset-icon"
            title="Stacked asset icon"
            tag="CANONICAL token + network visual"
            kicker="The token image with its network pip, drawn by TickerIcon. Balance rows, the Receive asset card and the token field all use it."
        >
            <Guidance
                what={<><code>&lt;TickerIcon chainId tick context /&gt;</code> draws the published token image, or a one-letter chip tinted by the ticker when there is none. A token on a chain other than its own shows the network pip; a native coin is the network.</>}
                when={<>Any row or control that stands for a held, receivable or sendable asset.</>}
                whenNot={<>A plain avatar: use the identity avatar.</>}
                variants={<><code>context</code> picks the size: <code>list</code> for rows, <code>header</code> beside a title, <code>hero</code> for the large Send icon.</>}
                doRule={<>✓ Pass the chain and the ticker and let the component pick the art</>}
                dontRule={<>✗ Crop token art to a circle · drop the pip on a token</>}
                supersedes={<>The hand-drawn copy this section used to show. Source: <code>TickerIcon.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<TickerIcon chainId="bitcoin-mainnet" tick="BTC" context="list" />`}
            </Markup>
            <LiveExample label="Native coin, then a token (list, header, hero)">
                <div style={{ display: 'flex', gap: 'var(--xc-space-4)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <TickerIcon chainId="bitcoin-mainnet" tick="BTC" context="list" />
                    <TickerIcon chainId="bitcoin-mainnet" tick="PEPECREATURE" context="list" />
                    <TickerIcon chainId="bitcoin-mainnet" tick="PEPECREATURE" context="header" />
                    <TickerIcon chainId="bitcoin-mainnet" tick="PEPECREATURE" context="hero" />
                </div>
            </LiveExample>
        </Section>
    );
}
