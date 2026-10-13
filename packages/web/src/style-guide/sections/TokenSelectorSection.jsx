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
            kicker="The full-page 'pick a coin or token' pattern behind Send and Receive: search, network, and All/Coins/Tokens filters dock above the shared balance list. Selecting a row hands {chainId, tick} to the host."
        >
            <Guidance
                what={<>A two-part stack: a toolbar with search, <code>NetworkFilter</code>, and pill segments, followed by the canonical <code>BalanceList</code>. The toolbar filters the list in place; there is no submit. Implemented once in <code>TokenPicker.jsx</code> and reused by Send and Receive via the <code>purpose</code> prop.</>}
                when={<>Any screen whose only job is choosing one asset from everything the wallet can see. Send lists only spendable balances; Receive adds zero-balance chains and platform-wide token discovery. Keep the toolbar even for short lists so muscle memory holds.</>}
                whenNot={<>Inline pickers inside a form (use the asset card that opens this page) · lists where rows carry actions other than "select" (balances tab uses the same card but with pin/hide affordances) · filter needs beyond search + kind → this page's toolbar swaps the segments for a network dropdown (see the address list pattern).</>}
                sizing={<>Toolbar gap <code>--xc-space-2</code>, bottom margin <code>--xc-space-3</code>. Search: <code>--xc-text-sm</code>, padding <code>--xc-space-2 --xc-space-3</code>, <code>--xc-radius-md</code>, <code>--xc-border-strong</code>. Segments: 999px pill, active fill <code>--xc-accent-primary</code>. Rows use the shared balance-list sizing.</>}
                doRule={<>✓ Filter as the user types · preserve the user's filters when controlled props are supplied · use <code>kindLocked</code> when the calling action accepts only coins or only tokens · show the empty-filter state inside the list page</>}
                dontRule={<>✗ Add sort controls (the list is sorted chain-then-asset, pinned first, always) · turn segments into a dropdown when there are only 2-3 kinds · mix selector rows with action rows in one card</>}
                supersedes={<>The toolbar rules in <code>TokenPicker.module.css</code> (<code>.toolbar</code>/<code>.search</code>/<code>.kindSegments</code>) plus <code>BalanceList</code> for the card. The dispensers list reuses this page shape with a network dropdown in place of the segments.</>}
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
