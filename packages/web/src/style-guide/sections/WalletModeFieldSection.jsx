// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { WalletModeField } from '@xchain-wallet/core/shared/components/WalletModeField.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function WalletModeFieldSection() {
    const [mode, setMode] = useState('full');
    return (
        <Section
            id="wallet-mode-field"
            title="Wallet mode field"
            tag="UNUSED: WalletModeField / walletModeLabel"
            kicker="The wallet-mode names: Normal, Signs on another phone, or Signer for another phone. Create and import no longer offer the choice; only the two-phone pairing sets the other two."
        >
            <Guidance
                what={<>The standard themed dropdown (<code>Select</code>, never radios: G119) with an icon and a one-line hint on each option, and a note that the choice is final. Wallet Details shows the mode read-only afterwards.</>}
                when={<>Nowhere today: the mode is set only by the two-phone pairing and shown as text through <code>walletModeLabel</code> (Wallet Details).</>}
                whenNot={<>Create and import: they no longer offer the choice.</>}
                doRule={<>✓ Pass <code>disabled</code> while the form is busy</>}
                dontRule={<>✗ Offer a mode switch on an existing wallet</>}
                supersedes={<>Source: <code>WalletModeField.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<WalletModeField value={mode} onChange={setMode} />`}
            </Markup>
            <LiveExample label="Normal selected">
                <WalletModeField value={mode} onChange={setMode} name="sg-wallet-mode" />
            </LiveExample>
        </Section>
    );
}
