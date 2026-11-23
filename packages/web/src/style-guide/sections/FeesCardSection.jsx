// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { FeesCard } from '@xchain-wallet/core/shared/components/FeesCard.jsx';
import { Section, Guidance, LiveExample } from '../StyleGuidePage.jsx';

export function FeesCardSection() {
    const [native, setNative] = useState(false);
    const tiers = {
        low: { coinAmount: '0.00001' },
        normal: { coinAmount: '0.000015' },
        fast: { coinAmount: '0.00002' },
    };
    const fiat = {
        formatNativeFee: (amount) => amount === '0.000015' ? '~$0.98' : '~$0.13',
        formatProtocolFee: () => '~$0.13',
        formatFeeTotal: () => '~$1.11',
    };
    return (
        <Section
            id="fees-card"
            title="Fees card"
            tag="CANONICAL · FeesCard"
            kicker="The fee-bearing action summary keeps the selected network fee, protocol fee, payment choice, and total together."
        >
            <Guidance
                what={<><code>FeesCard</code> receives the form's real fee selector, quote, native-fee state, and fiat formatters.</>}
                when={<>Actions whose indexer path charges a protocol fee.</>}
                whenNot={<>Actions with only a network fee.</>}
                doRule={<>✓ Keep the fee selector above the summary rows and pass the latest quote</>}
                dontRule={<>✗ Guess a protocol fee while the action is incomplete</>}
                supersedes={<>Loose fee toggles and per-form fee summaries.</>}
            />
            <LiveExample label="Bitcoin protocol fee choice">
                <FeesCard
                    feeSelector={<div>Network fee priority</div>}
                    tiers={tiers}
                    value={{ mode: 'normal' }}
                    coinTicker="BTC"
                    quote={{ xchainFee: '0.064', requiredFeeSats: 197 }}
                    nativeFeeProps={{ checked: native, onChange: setNative }}
                    fiat={fiat}
                />
            </LiveExample>
        </Section>
    );
}
