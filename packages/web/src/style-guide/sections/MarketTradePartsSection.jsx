// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { SwapTicket } from '@xchain-wallet/core/shared/components/marketTradeParts.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { SharedComponentExampleProvider } from './sharedComponentExamples.jsx';

const noop = () => {};

export function MarketTradePartsSection() {
    const [side, setSide] = useState('buy');
    const [pay, setPay] = useState('0.01');
    const [get, setGet] = useState('2500');
    return (
        <Section
            id="market-trade-parts"
            title="Market trade parts"
            tag="CANONICAL · marketTradeParts"
            kicker="The pieces of the market trading panels: the swap ticket with its flip button, and the Buy and Sell glyphs."
        >
            <Guidance
                what={<><code>SwapTicket</code> is the Trade page's Swap ticket, drawn with the shared Give/Get Quick cards: You pay over You get, a round flip between them and a Buying or Selling tag. Typing in one side fills the other, and leaving a field settles the typed side to its exact value. <code>BuyGlyph</code> and <code>SellGlyph</code> mark the two sides; <code>tidyQuotePrice</code> trims a quote to a readable price.</>}
                when={<>Market buy and sell panels, and any trade ticket that pays one asset to get another.</>}
                whenNot={<>Any form that is not a two-asset trade (Give / Get forms use the cards directly).</>}
                doRule={<>✓ Pass a balance line and a per-unit note under the Get field</>}
                dontRule={<>✗ Compute the other side with a rounded price: settle to the exact value on blur</>}
                supersedes={<>Source: <code>marketTradeParts.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<SwapTicket side="buy" chainId={chainId} payTick="BTC" getTick="PEPECASH" payValue={pay} getValue={get}
    onPayChange={setPay} onGetChange={setGet} onSettle={settle} payBalance="Balance 0.4821" getNote="at 0.000004 each" onFlip={flip} />`}
            </Markup>
            <LiveExample label="Buy ticket with a flip">
                <SharedComponentExampleProvider>
                    <SwapTicket
                        side={side}
                        chainId="bitcoin-mainnet"
                        payTick={side === 'buy' ? 'BTC' : 'PEPECASH'}
                        getTick={side === 'buy' ? 'PEPECASH' : 'BTC'}
                        payValue={pay}
                        getValue={get}
                        onPayChange={setPay}
                        onGetChange={setGet}
                        onSettle={noop}
                        payBalance="Balance 0.4821"
                        getNote="at 0.000004 each"
                        onFlip={() => setSide((s) => (s === 'buy' ? 'sell' : 'buy'))}
                    />
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}
