// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { InfoTip } from '@xchain-wallet/core/ui';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

export function InfoTipSection() {
    return (
        <Section id="info-tip" title="Info tip" tag="PRIMITIVE" kicker="Optional contextual help for an unfamiliar term without taking permanent form space.">
            <Guidance
                what={<>A keyboard-reachable help trigger whose tooltip re-anchors to remain inside narrow viewports.</>}
                when={<>Use for concise explanations of fee tiers, derivation paths, RBF, and other unfamiliar terms.</>}
                whenNot={<>Keep required instructions and error recovery inline where users cannot miss them.</>}
                sizing={<>The visible dot is 16px and the interactive target meets the shared tap minimum.</>}
                variants={<>Top or bottom placement and a custom accessible trigger label.</>}
                doRule={<>Write one short explanation that makes sense without protocol documentation.</>}
                dontRule={<>Do not hide required consent, risk, or recovery instructions in a tooltip.</>}
            />
            <Markup>
{`import { InfoTip } from '@xchain-wallet/core/ui';

<span>
    Replace-by-fee
    <InfoTip label="Lets you raise the fee while a payment is pending." />
</span>`}
            </Markup>
            <LiveExample label="Hover, focus, or press the help trigger.">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <p style={{ margin: 0 }}>
                        Replace-by-fee
                        <InfoTip label="Lets you raise the fee while a payment is pending." />
                    </p>
                    <p style={{ margin: 0 }}>
                        Derivation path
                        <InfoTip
                            placement="bottom"
                            aria="About derivation paths"
                            label="Identifies where this account sits in the wallet key tree."
                        />
                    </p>
                </div>
            </LiveExample>
        </Section>
    );
}
