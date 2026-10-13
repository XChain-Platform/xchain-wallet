// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { BalanceList } from '@xchain-wallet/core/shared/components/BalanceList.jsx';
import { TotalBalanceHero } from '@xchain-wallet/core/shared/components/TotalBalanceHero.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import {
    SAMPLE_BALANCE_ROWS,
    SharedComponentExampleProvider,
} from './sharedComponentExamples.jsx';

const PRIVACY_MASK = '•••••';

export function PrivacyModeSection() {
    return (
        <Section
            id="privacy-mode"
            title="Privacy mode"
            tag="GUIDANCE · figure-masking pattern"
            kicker="One global toggle masks every figure (balance / fiat / fee amount) across the wallet so a user can pull the app up in a public place without showing the world their net worth. Identifying labels (asset names, ticks, addresses) stay visible; the goal is hiding $$$, not making the app unusable."
        >
            <Guidance
                what={<>The shared <code>useBalancesHidden</code> hook persists one boolean in local storage and broadcasts changes to every mounted consumer. <code>TotalBalanceHero</code> owns the eye trigger; <code>BalanceList</code> and other amount surfaces subscribe to the same state.</>}
                doRule={<>✓ Mask figures: balance quantity, fiat conversion, fee amounts, transaction values, change deltas · keep identifying text visible: asset name, tick, chain badge, address, action labels · use the same <code>{PRIVACY_MASK}</code> glyph everywhere (no "<em>***</em>" or "<em>HIDDEN</em>"; one mask language) · let the shared hero and list consume <code>useBalancesHidden</code></>}
                dontRule={<>✗ Mask labels (turning "Bitcoin" into <code>{PRIVACY_MASK}</code> defeats wayfinding; the user still needs to know which row is which) · mask addresses (they're not private; they're already public on-chain) · build a per-row mask toggle (one global switch keeps the contract predictable; every figure is either shown or masked) · ask before enabling (it's a UI preference, not a security action)</>}
                supersedes={<>Per-component masking state. The canonical state lives in <code>useBalancesHidden</code>; the canonical mask glyph is <code>{PRIVACY_MASK}</code>.</>}
            />

            <Markup>
{`import { BalanceList } from '@xchain-wallet/core/shared/components/BalanceList.jsx';
import { TotalBalanceHero } from '@xchain-wallet/core/shared/components/TotalBalanceHero.jsx';

<TotalBalanceHero
    rows={rows}
    walletId={walletId}
    networkFilter={networkFilter}
/>
<BalanceList rows={rows} onSelectToken={openTokenDetail} />`}
            </Markup>

            <LiveExample label="Toggle the hero eye: the real hero and balance list share the mask state">
                <SharedComponentExampleProvider>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <TotalBalanceHero
                            rows={SAMPLE_BALANCE_ROWS}
                            walletId="style-guide-wallet"
                            networkFilter="all"
                        />
                        <BalanceList rows={SAMPLE_BALANCE_ROWS} />
                    </div>
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}
