// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChainBadge } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

const registry = registryLib.defaultRegistry();
const bitcoin = registry.get('bitcoin-mainnet');
const bitcoinTestnet = registry.get('bitcoin-testnet');

const rowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
};

export function ChainBadgeSection() {
    return (
        <Section id="chain-badge" title="Network badge" tag="PRIMITIVE" kicker="Compact, read-only network identity for summaries, lists, and review rows.">
            <Guidance
                what={<>The network icon alone by default, with the canonical display name exposed to assistive technology.</>}
                when={<>Use where the network is fixed and the user is reviewing or scanning data.</>}
                whenNot={<>Use <code>ChainPicker</code> or <code>NetworkField</code> when the user can change the network.</>}
                sizing={<><code>sm</code> fits list rows; <code>md</code> fits details and review summaries.</>}
                variants={<>Use <code>showName</code> only where the network name must appear beside the icon. Network-kind text is never rendered.</>}
                doRule={<>Pass the registry descriptor so color, icon, and network naming stay canonical.</>}
                dontRule={<>Do not substitute a badge for an editable network field or pass the removed <code>{'showNetworkKind={false}'}</code> option.</>}
            />
            <Markup>
{`import { ChainBadge } from '@xchain-wallet/core/ui';

<ChainBadge descriptor={chainRegistry.get(chainId)} size="sm" />`}
            </Markup>
            <LiveExample label="Icons are the default; named contexts opt in to the display name.">
                <div style={rowStyle}>
                    <ChainBadge descriptor={bitcoin} size="sm" />
                    <ChainBadge descriptor={bitcoinTestnet} size="md" />
                    <ChainBadge descriptor={bitcoinTestnet} showName />
                    <ChainBadge descriptor={bitcoin} showName={false} />
                </div>
            </LiveExample>
        </Section>
    );
}
