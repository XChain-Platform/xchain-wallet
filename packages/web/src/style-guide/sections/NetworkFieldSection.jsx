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
            kicker="THE way a form says which network the action runs on: a labeled ChainPicker, label “Network”, offering every chain the wallet holds addresses on. Every authoring form leads with it; it replaces the old fixed ChainBadge bubble at the top of forms."
        >
            <Guidance
                what={<>A named wrapper over <code>ChainPicker</code> that pins the house conventions: label <code>Network</code>, the wallet's own chains as options, testnet/regtest cue on. One import, zero styling decisions per form.</>}
                when={<>The top of every action-authoring form (Send, Claim rewards, Unstake, Delegate, Issue, Broadcast…). Forms opened from a specific context (a staking position's Claim, a contract's Stake) still render it, seeded to that chain, so the network is visible and retargetable like on any other form.</>}
                whenNot={<>Pure display of a fixed chain inside a review/summary list (that's <code>ChainBadge</code>). Filtering a list by coin family (that's the list toolbar's network filter dropdown).</>}
                doRule={<>✓ Offer every chain the wallet holds addresses on (<code>Object.keys(addressesByChain)</code>) · seed from the launching context · reset dependent state (source address, token) in <code>onChange</code></>}
                dontRule={<>✗ Render a bare <code>ChainBadge</code> bubble at the top of a form · restrict options to one chain just because the flow arrived with one · relabel it ("Chain", "Coin") per-form</>}
                supersedes={<>The <code>styles.chainLine</code> + <code>ChainBadge</code> header bubble pattern on authoring forms. Component: <code>packages/core/src/ui/NetworkField.jsx</code>.</>}
            />

            <Markup>
{`import { NetworkField } from '@xchain-wallet/core/ui';

<NetworkField
    value={chainId}
    onChange={(cid) => { setChainId(cid); setFromAddressId(null); }}
    chainIds={addressesByChain ? Object.keys(addressesByChain) : [chainId]}
    chainRegistry={chainRegistry}
/>`}
            </Markup>

            <LiveExample label="Standard form header: every wallet chain offered, seeded from the launching context.">
                <NetworkField
                    value={value}
                    onChange={setValue}
                    chainIds={WALLET_CHAINS}
                    chainRegistry={chainRegistry}
                />
            </LiveExample>
        </Section>
    );
}
