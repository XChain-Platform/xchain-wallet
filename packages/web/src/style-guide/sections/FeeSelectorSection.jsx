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
import { FeeSelector } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

// Hand-rolled tier fixture (doc-page only). The shape matches what
// `estimateNativeSendFeeTiers` returns, so the live FeeSelector below
// renders the same way it would in Send.
const SAMPLE_TIERS = {
    low:    { coinAmount: '0.00001500', etaMinutes: 60, rate: '1 sat/vB', rateValue: 1 },
    normal: { coinAmount: '0.00003000', etaMinutes: 20, rate: '2 sat/vB', rateValue: 2 },
    fast:   { coinAmount: '0.00007500', etaMinutes: 10, rate: '5 sat/vB', rateValue: 5 },
    unit:   'sat/vB',
};

// Doc-page fiat stub. In-app the caller passes a real formatter that
// converts the coin amount to the user's display currency via the price
// oracle. Here a fixed BTC rate keeps the readout figure realistic.
const formatFiat = (coinAmount) =>
    `$${(parseFloat(coinAmount) * 60000).toFixed(2)} USD`;

// Recompute a fee estimate from the user-typed Custom rate so the fee
// amount + fiat keep showing in Custom mode. In-app this is what Send
// passes via `customFeeEstimate`; here we scale off the sample tiers
// (rate 1 sat/vB -> 0.000015 BTC).
const customEstimateFor = (pick) => {
    const rate = Number.isFinite(pick.customRate) ? Math.max(0, pick.customRate) : 0;
    return {
        coinAmount: (rate * 0.000015).toFixed(8),
        rate: `${rate} sat/vB`,
        rateValue: rate,
    };
};

export function FeeSelectorSection() {
    const [sendPick, setSendPick] = useState({ mode: 'normal' });
    const [receivePick, setReceivePick] = useState({ mode: 'normal' });
    const [labeledPick, setLabeledPick] = useState({ mode: 'fast' });

    return (
        <Section
            id="fee-selector"
            title="Fee selector"
            tag="CANONICAL fee-priority picker"
            kicker="Low / Normal / Fast slider (optionally with Custom) over a native range input, styled with accent-color. Used anywhere the user expresses a fee preference: Send (typing the rate), Receive (encoding a preference into the QR), Settings defaults, etc."
        >
            <Guidance
                what={<>A 3- or 4-stop slider over <code>&lt;input type="range"&gt;</code>. A header row carries the label (left) and the active tier's ETA (right); the readout below the track shows the fee amount + coin ticker + fiat (left) and the rate / Custom input (right). Both readout figures are click-to-edit when <code>allowCustom</code>: clicking the rate opens the Custom rate input seeded with the active tier's rate, and clicking the fee amount opens an exact-fee input (the typed fee is converted to the equivalent rate internally, so <code>onChange</code> still emits <code>{'{ mode: \'custom\', customRate }'}</code>). Either edit snaps the slider to the Custom stop. Tick labels are positioned under each slider nub. Renders a placeholder ("Fee estimate unavailable for this chain.") when no <code>tiers</code> are passed.</>}
                when={<>Any form that submits a transaction or encodes a fee preference. Always use this (never build a one-off fee picker). Pulling tiers from <code>estimateNativeSendFeeTiers</code> (sync seed) + <code>fetchNativeSendFeeTiers</code> (live SDK upgrade) gives the consistent BTC/LTC/DOGE handling.</>}
                whenNot={<>Settings panels that store the user's default fee strategy use a simpler radio group (Low/Normal/Fast/Custom) rather than this slider. The slider implies "this transaction" intent; settings imply "future transactions".</>}
                variants={<>
                    <code>allowCustom</code> (default <code>true</code>, set <code>false</code> on Receive to omit the Custom stop, the sat/vB input, and both click-to-edit readout affordances). <code>label</code> renders inside the wrap so the label-to-slider gap matches the internal rhythm; don't pair the component with an external label. <code>disabled</code> for read-only review states.
                </>}
                doRule={<>✓ Always pull tiers via the feeEstimate helpers · use <code>allowCustom={'{false}'}</code> on receive-style flows (custom sat/vB ages out before the QR is scanned) · pass the <code>label</code> prop instead of wrapping the component in your own labeled container</>}
                dontRule={<>✗ Build your own tier picker · hard-code rates inline · hide the placeholder when tiers fail to load (leaving the slot empty makes the affordance undiscoverable)</>}
                supersedes={<>Any inline tier picker. The component lives at <code>packages/core/src/ui/FeeSelector.jsx</code>; the tier-fetch helpers at <code>packages/core/src/flows/feeEstimate.js</code>.</>}
            />

            <Markup>
{`import { FeeSelector } from '@xchain-wallet/core/ui';
import {
    estimateNativeSendFeeTiers,
    fetchNativeSendFeeTiers,
} from '@xchain-wallet/core/flows/feeEstimate';

const [feeTiers, setFeeTiers] = useState(null);
const [feePick, setFeePick] = useState({ mode: 'normal' });

useEffect(() => {
    if (!chainId) return;
    setFeeTiers(estimateNativeSendFeeTiers({ chainId, chainRegistry }));
    fetchNativeSendFeeTiers({ messaging, chainId, chainRegistry })
        .then((tiers) => tiers && setFeeTiers(tiers));
}, [chainId, messaging]);

<FeeSelector
    label="Network fee"
    tiers={feeTiers}
    value={feePick}
    onChange={setFeePick}
    coinTicker={coinTicker}  // BTC / LTC / DOGE, shown after the fee
    formatFiat={formatFiat}  // coin amount -> display-currency string
    allowCustom={false}      // omit / true on Send; false on Receive
/>`}
            </Markup>

            <LiveExample label="Send variant: Low / Normal / Fast / Custom. Click the fee amount or the rate to edit it directly; either edit jumps the slider to Custom.">
                <FeeSelector
                    tiers={SAMPLE_TIERS}
                    value={sendPick}
                    onChange={setSendPick}
                    customEstimate={sendPick.mode === 'custom' ? customEstimateFor(sendPick) : null}
                    coinTicker="BTC"
                    formatFiat={formatFiat}
                />
            </LiveExample>

            <LiveExample label="Receive variant: Low / Normal / Fast (no Custom)">
                <FeeSelector
                    tiers={SAMPLE_TIERS}
                    value={receivePick}
                    onChange={setReceivePick}
                    allowCustom={false}
                    coinTicker="BTC"
                    formatFiat={formatFiat}
                />
            </LiveExample>

            <LiveExample label="With inline label: Network fee + ETA on the label line, fee + fiat below">
                <FeeSelector
                    label="Network fee"
                    tiers={SAMPLE_TIERS}
                    value={labeledPick}
                    onChange={setLabeledPick}
                    customEstimate={labeledPick.mode === 'custom' ? customEstimateFor(labeledPick) : null}
                    coinTicker="BTC"
                    formatFiat={formatFiat}
                />
            </LiveExample>

            <LiveExample label="No tiers available: built-in placeholder">
                <FeeSelector
                    tiers={null}
                    value={{ mode: 'normal' }}
                    onChange={() => {}}
                />
            </LiveExample>
        </Section>
    );
}
