// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssetMark } from '@xchain-wallet/core/ui/AssetMark.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function AssetMarkSection() {
    return (
        <Section
            id="asset-mark"
            title="Asset mark"
            tag="Asset image with network overlay"
            kicker="The asset image that balance, activity and market rows draw, with the network mark on every non-native asset."
        >
            <Guidance
                what={<><code>&lt;AssetMark chainId tick imageUrl isNative /&gt;</code> draws the asset image. A native coin shows the network mark as its image. A token shows its own image with the network mark overlaid, or a lettered network badge when the network has no bundled icon.</>}
                when={<>Rows that list assets without network text, so the same ticker on two networks stays distinguishable.</>}
                whenNot={<>A network label beside text: use the network badge.</>}
                variants={<><code>isNative</code> swaps the asset image for the network mark. A missing or failed image falls back to a one-letter monogram of the ticker.</>}
                doRule={<>✓ Pass the network and the ticker and let the mark pick the fallback</>}
                dontRule={<>✗ Hide the overlay on a token · draw a letter behind transparent artwork</>}
                supersedes={<>Per-row image markup in balance, activity and market lists. Source: <code>AssetMark.jsx</code> in <code>ui</code>.</>}
            />
            <Markup>
{`<AssetMark chainId="bitcoin-mainnet" tick="PEPECREATURE" imageUrl={tokenImageUrl} />`}
            </Markup>
            <LiveExample label="Native coin, token without an image, token with an unknown network">
                <div style={{ display: 'flex', gap: 'var(--xc-space-4)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <AssetMark chainId="bitcoin-mainnet" tick="BTC" isNative />
                    <AssetMark chainId="bitcoin-mainnet" tick="PEPECREATURE" />
                    <AssetMark chainId="unknown-network" tick="ABC" />
                </div>
            </LiveExample>
        </Section>
    );
}
