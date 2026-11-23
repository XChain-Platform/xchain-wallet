// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { VerifiedBadge } from '@xchain-wallet/core/ui';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

const rowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
};

export function VerifiedBadgeSection() {
    return (
        <Section id="verified-badge" title="Verified badge" tag="PRIMITIVE" kicker="A proof verdict for values checked independently against the network record.">
            <Guidance
                what={<>A compact status badge for verified, failed, unavailable, and in-progress proof checks.</>}
                when={<>Use next to balances or actions whose light-client proof status matters.</>}
                whenNot={<>Do not attach it to native-coin values that have no XChain state-tree proof.</>}
                sizing={<><code>sm</code> for rows and <code>md</code> for detail views.</>}
                variants={<>Verified, proof failed, unverified, and verifying.</>}
                doRule={<>Pass known reason codes so the title can explain unavailable and failed states in plain words.</>}
                dontRule={<>Do not turn a failed proof into a neutral loading or informational status.</>}
            />
            <Markup>
{`import { VerifiedBadge } from '@xchain-wallet/core/ui';

<VerifiedBadge status={proof.status} reason={proof.reason} />`}
            </Markup>
            <LiveExample label="All proof states use stable words and tones.">
                <div style={rowStyle}>
                    <VerifiedBadge status="verified" />
                    <VerifiedBadge status="failed" reason="CHECKPOINT_QUORUM_FAILED" />
                    <VerifiedBadge status="unavailable" reason="NOT_YET_CHECKPOINTED" />
                    <VerifiedBadge status="pending" size="md" />
                </div>
            </LiveExample>
        </Section>
    );
}
