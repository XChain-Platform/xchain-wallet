// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { TokenPicker } from '@xchain-wallet/core/shared/routes/TokenPicker.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { SharedComponentExampleProvider } from './sharedComponentExamples.jsx';

export function TokenSelectorSection() {
    return (
        <Section
            id="token-selector"
            title="Token selector (Send / Receive picker)"
            tag="CANONICAL pick-an-asset page"
            kicker="The full-page 'pick a coin or token' screen behind Send and Receive: the PageHeader carries one filter menu (search, network, and a Coins and tokens / Coins / Tokens dropdown); the shared balance list fills the page and selecting a row hands {chainId, tick} to the host."
        >
            <Guidance
                what={<>A nested <code>PageHeader</code> whose trailing slot holds <code>ListFilterMenu</code> (search, network, asset-kind <code>IconSelect</code>), then the canonical <code>BalanceList</code>. The filter narrows the list in place; there is no submit. Implemented once in <code>TokenPicker.jsx</code>, reused by Send, Receive and token forms through <code>purpose</code> (<code>'send'</code> | <code>'receive'</code>) and <code>rows</code> (a caller's own eligible tokens).</>}
                when={<>Any screen whose only job is choosing one asset from everything the wallet can see. Send lists only spendable balances; Receive adds zero-balance networks and platform-wide token discovery. Keep the filter menu even for short lists so muscle memory holds.</>}
                whenNot={<>Inline pickers inside a form (use the asset card that opens this page) · lists where rows carry actions other than "select" (balances tab uses the same card but with pin/hide affordances).</>}
                sizing={<>No toolbar of its own: the list takes the page gutter. The asset-kind control is an <code>IconSelect</code> size <code>md</code>.</>}
                doRule={<>✓ Filter as the user types · preserve the user's filters when controlled props are supplied · use <code>kindLocked</code> when the calling action accepts only coins or only tokens · show the empty-filter state inside the list page</>}
                dontRule={<>✗ Add sort controls (the list is sorted chain-then-asset, pinned first, always) · draw your own toolbar above the list · mix selector rows with action rows in one card</>}
                supersedes={<>The toolbar rules that used to live in <code>TokenPicker.module.css</code>; the filter is the shared <code>ListFilterMenu</code>.</>}
            />

            <Markup>
{`import { TokenPicker } from '@xchain-wallet/core/shared/routes/TokenPicker.jsx';

<TokenPicker
    purpose="send"
    walletId={walletId}
    accountId={accountId}
    title="Send"
    onBack={back}
    onSelect={({ chainId, tick }) => openSendForm(chainId, tick)}
/>`}
            </Markup>

            <LiveExample label="Send picker with live search, network, and kind filters" padded={false}>
                <SharedComponentExampleProvider>
                    <TokenPicker
                        purpose="send"
                        walletId="style-guide-wallet"
                        accountId="style-guide-account"
                        title="Send"
                        onBack={() => {}}
                        onSelect={() => {}}
                    />
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}
