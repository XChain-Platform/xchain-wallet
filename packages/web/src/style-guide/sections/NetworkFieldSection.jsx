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
import { NetworkField } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const chainRegistry = registryLib.defaultRegistry();
const WALLET_CHAINS = ['bitcoin-regtest', 'litecoin-regtest', 'dogecoin-regtest'];

export function NetworkFieldSection() {
    const [value, setValue] = useState('bitcoin-regtest');

    return (
        <Section
            id="network-field"
            title="Network field"
            tag="CANONICAL form field"
            kicker="THE way a form says which network the action runs on: a field-shaped button with a list icon that opens the full-screen network picker. Every authoring form uses it instead of a dropdown."
        >
            <Guidance
                what={<>A field-shaped button showing the current network and a trailing list icon. It opens <code>NetworkPicker</code>, whose full-screen list gives every row its network icon and returns the selection to the form.</>}
                when={<>The top of every action-authoring form (Send, Claim rewards, Unstake, Delegate, Issue, Broadcast…). Forms opened from a specific context (a staking position's Claim, a contract's Stake) still render it, seeded to that network, so the network is visible and retargetable like on any other form.</>}
                whenNot={<>Pure display of a fixed network inside a review/summary list (that's <code>ChainBadge</code>). Filtering a list by coin family (that's the list toolbar's network filter dropdown).</>}
                sizing={<><code>md</code> matches standard form controls; <code>lg</code> matches hero fields on focused transaction screens.</>}
                variants={<>Custom label and <code>md</code> or <code>lg</code> size. A host can pass <code>onOpenPicker</code> when it owns the picker screen.</>}
                doRule={<>✓ Offer every network the wallet holds addresses on (<code>Object.keys(addressesByChain)</code>) · seed from the launching context · reset dependent state (source address, token) in <code>onChange</code></>}
                dontRule={<>✗ Use a dropdown or native <code>&lt;select&gt;</code> for a network field · render a bare <code>ChainBadge</code> bubble at the top of a form · restrict options to one network just because the flow arrived with one</>}
                supersedes={<>The <code>styles.chainLine</code> + <code>ChainBadge</code> header bubble pattern on authoring forms. Component: <code>packages/core/src/ui/NetworkField.jsx</code>.</>}
            />

            <Markup>
{`import { NetworkField, NetworkPicker } from '@xchain-wallet/core/ui';

<NetworkField
    value={chainId}
    onChange={(cid) => { setChainId(cid); setFromAddressId(null); }}
    chainIds={addressesByChain ? Object.keys(addressesByChain) : [chainId]}
    chainRegistry={chainRegistry}
/>

<NetworkPicker
    value={chainId}
    onSelect={setChainId}
    onBack={closePicker}
    chainIds={allowedChainIds}
    chainRegistry={chainRegistry}
/>`}
            </Markup>

            <LiveExample label="Standard form header: every wallet network offered, seeded from the launching context.">
                <NetworkField
                    value={value}
                    onChange={setValue}
                    chainIds={WALLET_CHAINS}
                    chainRegistry={chainRegistry}
                />
            </LiveExample>
            <LiveExample label="Hero size for a focused transaction screen.">
                <NetworkField
                    value={value}
                    onChange={setValue}
                    chainIds={WALLET_CHAINS}
                    chainRegistry={chainRegistry}
                    size="lg"
                />
            </LiveExample>
        </Section>
    );
}
