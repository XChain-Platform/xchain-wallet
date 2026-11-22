// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MultisigBadge } from '@xchain-wallet/core/ui';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

const rowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
};

export function MultisigBadgeSection() {
    return (
        <Section id="multisig-badge" title="Multisig badge" tag="PRIMITIVE" kicker="Compact signing-threshold and script-family identity for multisig accounts and transactions.">
            <Guidance
                what={<>A threshold badge that combines plain-language scheme names with protocol detail in its accessible label and title.</>}
                when={<>Use anywhere a multisig address, account, or signing session appears.</>}
                whenNot={<>Do not show it for single-key accounts or use it as the signing-progress indicator.</>}
                sizing={<><code>sm</code> for rows and <code>md</code> for primary account details.</>}
                variants={<>Classic, SegWit, and Taproot scheme tones.</>}
                doRule={<>Pass the persisted multisig threshold, cosigner count, and scheme without relabeling them.</>}
                dontRule={<>Do not expose only P2SH, P2WSH, or MuSig2 jargon as the visible label.</>}
            />
            <Markup>
{`import { MultisigBadge } from '@xchain-wallet/core/ui';

<MultisigBadge threshold={2} cosignerCount={3} scheme="p2wsh-multisig" />`}
            </Markup>
            <LiveExample label="Scheme families use distinct tones while keeping the threshold first.">
                <div style={rowStyle}>
                    <MultisigBadge threshold={2} cosignerCount={3} scheme="p2sh-multisig" size="sm" />
                    <MultisigBadge threshold={2} cosignerCount={3} scheme="p2wsh-multisig" />
                    <MultisigBadge threshold={3} cosignerCount={5} scheme="taproot-musig2" />
                </div>
            </LiveExample>
        </Section>
    );
}
