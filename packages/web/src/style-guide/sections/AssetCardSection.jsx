// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { TickerIcon } from '@xchain-wallet/core/shared/components/TickerIcon.jsx';
import receiveStyles from '@xchain-wallet/core/shared/routes/Receive.module.css';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function AssetCardSection() {
    return (
        <Section
            id="asset-card"
            title="Asset card (Receive)"
            tag="whole-card tap target"
            kicker="The chosen asset at the top of Receive: one card that is a single button back to the asset picker. The example uses the Receive screen's own class."
        >
            <Guidance
                what={<>A <code>button</code> with the Receive <code>.assetCard</code> class holding a <code>TickerIcon</code>. Its accessible name states the asset and its network.</>}
                when={<>The top of a screen that works on one chosen asset and can send the user back to the picker.</>}
                whenNot={<>The Send hero (icon only).</>}
                doRule={<>✓ Name the asset and network in <code>aria-label</code></>}
                dontRule={<>✗ Add a second control inside the card</>}
                supersedes={<>The hand-drawn copy this section used to show. Source: <code>Receive.jsx</code> and <code>Receive.module.css</code>.</>}
            />
            <Markup>
{`<button type="button" className={styles.assetCard} onClick={openPicker} aria-label="Change asset (currently BTC on Bitcoin)">
    <TickerIcon chainId={chainId} tick={tick} size={48} />
</button>`}
            </Markup>
            <LiveExample label="Receive asset card">
                <button type="button" className={receiveStyles.assetCard} aria-label="Change asset (currently BTC on Bitcoin)">
                    <TickerIcon chainId="bitcoin-mainnet" tick="BTC" size={48} />
                </button>
            </LiveExample>
        </Section>
    );
}
