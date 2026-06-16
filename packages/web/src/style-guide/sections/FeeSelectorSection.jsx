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

// Hand-rolled tier fixture — doc-page only. The shape matches what
// `estimateNativeSendFeeTiers` returns, so the live FeeSelector below
// renders the same way it would in Send.
const SAMPLE_TIERS = {
    low:    { coinAmount: '0.00001500', etaMinutes: 60, rate: '1 sat/vB', rateValue: 1 },
    normal: { coinAmount: '0.00003000', etaMinutes: 20, rate: '2 sat/vB', rateValue: 2 },
    fast:   { coinAmount: '0.00007500', etaMinutes: 10, rate: '5 sat/vB', rateValue: 5 },
    unit:   'sat/vB',
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
            kicker="Low / Normal / Fast slider (optionally with Custom) over a native range input, styled with accent-color. Used anywhere the user expresses a fee preference — Send (typing the rate), Receive (encoding a preference into the QR), Settings defaults, etc."
        >
            <Guidance
                what={<>A 3- or 4-stop slider over <code>&lt;input type="range"&gt;</code>, with tier readout (coin amount + ETA + rate) below the track. Custom mode reveals a numeric input for the rate. Renders a placeholder ("Fee estimate unavailable for this chain.") when no <code>tiers</code> are passed.</>}
                when={<>Any form that submits a transaction or encodes a fee preference. Always use this — never build a one-off fee picker. Pulling tiers from <code>estimateNativeSendFeeTiers</code> (sync seed) + <code>fetchNativeSendFeeTiers</code> (live SDK upgrade) gives the consistent BTC/LTC/DOGE handling.</>}
                whenNot={<>Settings panels that store the user's default fee strategy use a simpler radio group (Low/Normal/Fast/Custom) rather than this slider — the slider implies "this transaction" intent; settings imply "future transactions".</>}
                variants={<>
                    <code>allowCustom</code> (default <code>true</code>, set <code>false</code> on Receive to omit the Custom stop and the sat/vB input). <code>label</code> renders inside the wrap so the label-to-slider gap matches the internal rhythm — don't pair the component with an external label. <code>disabled</code> for read-only review states.
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
    label="Fee priority"
    tiers={feeTiers}
    value={feePick}
    onChange={setFeePick}
    allowCustom={false}      // omit / true on Send; false on Receive
/>`}
            </Markup>

            <LiveExample label="Send variant — Low / Normal / Fast / Custom">
                <FeeSelector
                    tiers={SAMPLE_TIERS}
                    value={sendPick}
                    onChange={setSendPick}
                />
            </LiveExample>

            <LiveExample label="Receive variant — Low / Normal / Fast (no Custom)">
                <FeeSelector
                    tiers={SAMPLE_TIERS}
                    value={receivePick}
                    onChange={setReceivePick}
                    allowCustom={false}
                />
            </LiveExample>

            <LiveExample label="With inline label — preferred over an external wrapper">
                <FeeSelector
                    label="Fee priority"
                    tiers={SAMPLE_TIERS}
                    value={labeledPick}
                    onChange={setLabeledPick}
                    allowCustom={false}
                />
            </LiveExample>

            <LiveExample label="No tiers available — built-in placeholder">
                <FeeSelector
                    tiers={null}
                    value={{ mode: 'normal' }}
                    onChange={() => {}}
                />
            </LiveExample>
        </Section>
    );
}
