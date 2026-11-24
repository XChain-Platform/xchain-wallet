// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CopyButton } from '@xchain-wallet/core/ui';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

export function CopyButtonSection() {
    return (
        <Section id="copy-button" title="Copy button" tag="PRIMITIVE" kicker="The single clipboard path, with explicit success and failure feedback.">
            <Guidance
                what={<>A text-and-icon button that copies through the shared clipboard policy and briefly reports the outcome.</>}
                when={<>Use beside addresses, transaction IDs, signatures, and other values users need elsewhere.</>}
                whenNot={<>Do not offer copying when the surrounding flow can pass the value directly.</>}
                sizing={<>Content-sized and suitable for an inline detail row or compact action group.</>}
                variants={<>Custom label, accessible label, feedback duration, sensitive clipboard handling, <code>appearance="outlined"</code> for a per-row action, <code>iconOnly</code>, and <code>onCopied</code>.</>}
                doRule={<>Set <code>sensitive</code> for seed words and private keys so native clipboard policy is enforced.</>}
                dontRule={<>Do not call <code>navigator.clipboard</code> directly from a route.</>}
            />
            <Markup>
{`import { CopyButton } from '@xchain-wallet/core/ui';

<CopyButton value={address} label="Copy Address" />`}
            </Markup>
            <LiveExample label="Copy feedback is announced and returns to idle automatically.">
                <CopyButton value={ADDRESS} label="Copy Address" />
            </LiveExample>
        </Section>
    );
}
