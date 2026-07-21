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
import { TokenField } from '@xchain-wallet/core/shared/components/TokenField.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

// Demo selections use the bundled mainnet chain ids so TickerIcon and the
// chain name resolve against the default registry, exactly as in-app.
const BTC = { chainId: 'bitcoin-mainnet', tick: 'BTC' };
const PEPE = { chainId: 'bitcoin-mainnet', tick: 'PEPECREATURE' };

export function TokenFieldSection() {
    const [mdVal, setMdVal] = useState(PEPE);
    const [lgVal, setLgVal] = useState(BTC);
    const [emptyVal, setEmptyVal] = useState(/** @type {null | {chainId:string,tick:string}} */ (null));

    // In-app onOpenPicker navigates to the full-page TokenPicker and writes the
    // chosen { chainId, tick } back via `value`. Here we just cycle a demo
    // selection so the click is visibly wired.
    const cycle = (setter) => () => setter((v) => (v && v.tick === 'BTC' ? PEPE : BTC));

    return (
        <Section
            id="token-field"
            title="Token field"
            tag="CANONICAL inline token picker"
            kicker="The compact 'which token' field for forms: shows the selected token's icon, chain pip, ticker, and chain, and opens the full-page Token selector when tapped. Replaces the bare 'type the ticker' text input used across the action forms."
        >
            <Guidance
                what={<>A field-shaped button showing <code>TickerIcon</code> (token icon + chain pip) + ticker + "on {'{chain}'}" + a caret, styled to match the <code>Input</code> chrome at the same <code>size</code>. Presentation + click only: it calls <code>onOpenPicker</code> and the host opens the full-page <code>TokenPicker</code> and feeds the chosen <code>{'{ chainId, tick }'}</code> back via <code>value</code> (the same pattern as <code>AmountField</code>, which is presentation-only while the route owns the data).</>}
                when={<>Any form where the user chooses an existing token or coin they hold: Send, dispenser give-token, dividend/airdrop token, swap sides, contract stake token, etc. Use it instead of a bare ticker <code>Input</code> so the icon, chain, and picker are consistent everywhere.</>}
                whenNot={<>Creating a brand-new ticker (Issue token) is free-text, not a selection, so it stays an <code>Input</code>. When the token is fixed by context (owner actions launched from a specific token) use the read-only <code>LockedTokenContext</code> chip instead.</>}
                sizing={<>Matches the Input size contract: <code>md</code> (36px, default, 20px icon) or <code>size="lg"</code> (48px, 24px icon) for hero screens like Send.</>}
                variants={<><code>size="md" | "lg"</code>. <code>value={'{ chainId, tick }'}</code> or <code>null</code> for the empty "Select a token" state. <code>label</code> (default "Token"), <code>placeholder</code>, <code>disabled</code>, <code>error</code>.</>}
                doRule={<>✓ Own the picker navigation in the host (wire <code>onOpenPicker</code> to open <code>TokenPicker</code>, write the result to <code>value</code>) · keep the empty state's "Select a token" placeholder · use <code>lg</code> only on hero forms</>}
                dontRule={<>✗ Put a raw ticker text box on a form when the user is picking something they already hold · bake routing into the component (host owns navigation) · use it for creating a new ticker</>}
                supersedes={<>The bare <code>&lt;Input label="Token"/"Ticker"&gt;</code> pattern repeated across the action forms. Component at <code>packages/core/src/shared/components/TokenField.jsx</code>; opens <code>packages/core/src/shared/routes/TokenPicker.jsx</code>; icon from <code>TickerIcon.jsx</code>.</>}
            />

            <Markup>
{`import { TokenField } from '@xchain-wallet/core/shared/components/TokenField.jsx';

const [token, setToken] = useState(null); // { chainId, tick } | null

<TokenField
    label="Token"
    size="lg"                        // md (default) elsewhere
    value={token}
    onOpenPicker={() => openTokenPicker((sel) => setToken(sel))}
/>`}
            </Markup>

            <LiveExample label="Default (md), token selected. Click to cycle the demo selection (in-app this opens the Token picker).">
                <TokenField value={mdVal} onOpenPicker={cycle(setMdVal)} />
            </LiveExample>

            <LiveExample label="Hero (lg): Send's token field, native coin selected.">
                <TokenField size="lg" value={lgVal} onOpenPicker={cycle(setLgVal)} />
            </LiveExample>

            <LiveExample label="Empty state: no token chosen yet. Click to pick one.">
                <TokenField value={emptyVal} onOpenPicker={() => setEmptyVal(PEPE)} />
            </LiveExample>
        </Section>
    );
}
