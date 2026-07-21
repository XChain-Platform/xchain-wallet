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
import { ChainPicker } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const chainRegistry = registryLib.defaultRegistry();
const MAINNET_CHAINS = ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'];
const WITH_TESTNET = ['bitcoin-mainnet', 'bitcoin-testnet', 'litecoin-mainnet', 'dogecoin-mainnet'];

export function ChainPickerSection() {
    const [mdVal, setMdVal] = useState('bitcoin-mainnet');
    const [lgVal, setLgVal] = useState('litecoin-mainnet');
    const [kindVal, setKindVal] = useState('bitcoin-testnet');

    return (
        <Section
            id="chain-picker"
            title="Chain picker"
            tag="CANONICAL network selector"
            kicker="The 'which network' selector on nearly every form (Send, Swap, Issue, Add address, Compose message, filters). A dropdown showing the chain's icon + name, with a testnet/regtest cue. Sized to the shared Input contract so it lines up with the other fields."
        >
            <Guidance
                what={<>A custom single-select popover (not a native <code>&lt;select&gt;</code>) whose trigger matches the shared <code>Input</code> chrome and size: one line of chain icon + display name + an optional <code>· testnet</code> / <code>· regtest</code> suffix + a caret. The dropdown lists each chain's icon, name, ticker, and network kind, and adds a search box past 6 options. Icons come from <code>branding.chainIconSmallUrl</code>, so it stays decoupled from the registry's image wiring.</>}
                when={<>Any form field that answers "which network are we operating on": Send, Swap, Issue, Add address, Compose message, market filters. Use it instead of a native <code>Select</code> so the chain icon and the mainnet-vs-testnet cue are consistent everywhere.</>}
                whenNot={<>Picking a token/asset (that's the Token field, which opens the balance-list picker). Showing a fixed, non-editable chain (use <code>ChainBadge</code>). A yes/no or small enum with no icons (a plain <code>Select</code> is lighter).</>}
                sizing={<>Matches the Input size contract: <code>md</code> (36px, default, 20px icon) sits inline with a form's other inputs; <code>size="lg"</code> (48px, 24px icon) for hero screens. Previously the trigger was a two-line stack that rendered ~48px and towered over sibling inputs; it's now one line at the standard height.</>}
                variants={<><code>size="md" | "lg"</code>. <code>hideNetworkKind</code> drops the <code>· testnet</code> suffix (Receive, already scoped to the user's addresses). <code>placeholder</code> for the unselected state. Search appears automatically past 6 chains.</>}
                doRule={<>✓ Pass the shared <code>chainRegistry</code> and the form's allowed <code>chainIds</code> · keep the testnet/regtest cue on money-moving forms · use <code>lg</code> only on hero screens</>}
                dontRule={<>✗ Fall back to a native <code>&lt;select&gt;</code> that drops the chain icons · use it to pick a token · re-add a two-line trigger (it breaks the field-height alignment)</>}
                supersedes={<>The oversized two-line trigger. The component lives at <code>packages/core/src/ui/ChainPicker.jsx</code>; the size contract is shared with <code>Input</code> (see Field sizes).</>}
            />

            <Markup>
{`import { ChainPicker } from '@xchain-wallet/core/ui';

<ChainPicker
    label="Chain"
    size="md"                       // lg on hero screens
    value={chainId}
    onChange={setChainId}
    chainIds={allowedChainIds}
    chainRegistry={chainRegistry}
/>`}
            </Markup>

            <LiveExample label="Default (md): sits inline with the form's other 36px inputs.">
                <ChainPicker
                    label="Chain"
                    value={mdVal}
                    onChange={setMdVal}
                    chainIds={MAINNET_CHAINS}
                    chainRegistry={chainRegistry}
                />
            </LiveExample>

            <LiveExample label="Hero (lg): 48px, for focused single-field screens.">
                <ChainPicker
                    label="Chain"
                    size="lg"
                    value={lgVal}
                    onChange={setLgVal}
                    chainIds={MAINNET_CHAINS}
                    chainRegistry={chainRegistry}
                />
            </LiveExample>

            <LiveExample label="Testnet cue: non-mainnet chains show a · testnet / · regtest suffix (the 'real money vs play money' signal).">
                <ChainPicker
                    label="Chain"
                    value={kindVal}
                    onChange={setKindVal}
                    chainIds={WITH_TESTNET}
                    chainRegistry={chainRegistry}
                />
            </LiveExample>
        </Section>
    );
}
