// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SelectedTokenHero } from '@xchain-wallet/core/shared/routes/Send.jsx';
import { registry as registryLib } from '@xchain-wallet/core';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const chainRegistry = registryLib.defaultRegistry();

export function AssetHeroSection() {
    const bitcoin = chainRegistry.get('bitcoin-mainnet');
    return (
        <Section
            id="asset-hero"
            title="Asset hero (Send)"
            tag="vertical, icon-only tap target"
            kicker="The large centred token icon at the top of Send. The icon is the only tappable part, so the space around it stays inert."
        >
            <Guidance
                what={<><code>SelectedTokenHero</code> from <code>Send.jsx</code> draws the icon and its network pip; with <code>onChangeAsset</code> the icon is a button named "Change asset (currently X)", without it the hero is plain.</>}
                when={<>The top of a form that works on one chosen asset.</>}
                whenNot={<>Lists of assets (rows) · the Receive asset card.</>}
                doRule={<>✓ Make only the icon clickable</>}
                dontRule={<>✗ Make the whole row a button · fill a rectangle behind the round icon on hover</>}
                supersedes={<>The hand-drawn copy this section used to show. Source: <code>SelectedTokenHero</code> in <code>shared/routes/Send.jsx</code>.</>}
            />
            <Markup>
{`<SelectedTokenHero chainId={chainId} tick={tick} descriptor={descriptor} onChangeAsset={openPicker} allowRemoteImages={false} />`}
            </Markup>
            <LiveExample label="Native coin">
                <SelectedTokenHero chainId="bitcoin-mainnet" tick="BTC" descriptor={bitcoin} onChangeAsset={() => {}} allowRemoteImages={false} />
            </LiveExample>
            <LiveExample label="Token on Bitcoin (with the network pip)">
                <SelectedTokenHero chainId="bitcoin-mainnet" tick="PEPECREATURE" descriptor={bitcoin} onChangeAsset={() => {}} allowRemoteImages={false} />
            </LiveExample>
        </Section>
    );
}
