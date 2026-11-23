// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ContractConsentPanel } from '@xchain-wallet/core/shared/components/ContractConsentPanel.jsx';
import { OwnerWithdrawWarning } from '@xchain-wallet/core/shared/components/OwnerWithdrawWarning.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function ContractNoticesSection() {
    return (
        <Section
            id="contract-notices"
            title="Contract consent and owner notices"
            tag="CANONICAL · ContractConsentPanel / OwnerWithdrawWarning"
            kicker="The two things a user must read before sending value to a contract: what the contract may do with it, and whether its deployer can take it back."
        >
            <Guidance
                what={<><code>ContractConsentPanel</code> renders definition-list rows (permission, fee cap, provenance) from the contract manifest; an unknown manifest says it could not be checked and never reads as unrestricted. <code>OwnerWithdrawWarning</code> is a warning <code>FormNotice</code> shown only when the deployer can withdraw.</>}
                when={<>Review and detail screens for a contract address. The consent rows go inside a <code>dl</code> the caller styles.</>}
                whenNot={<>Contracts the wallet has no manifest for and no way to check: show the unavailable state, not nothing.</>}
                doRule={<>✓ Pass the caller's own label and value classes so the rows match their list</>}
                dontRule={<>✗ Hide the warning behind a disclosure</>}
                supersedes={<>Source: <code>ContractConsentPanel.jsx</code>, <code>OwnerWithdrawWarning.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<dl><ContractConsentPanel manifest={manifest} /></dl>
<OwnerWithdrawWarning ownerWithdraw={contract.ownerWithdraw} />`}
            </Markup>
            <LiveExample label="Consent panel: declared permissions">
                <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 'var(--xc-space-2)', margin: 0 }}>
                    <ContractConsentPanel manifest={{ status: 'declared', permissions: ['transfer', 'mint'], maxTakeBps: 250 }} />
                </dl>
            </LiveExample>
            <LiveExample label="Consent panel: could not be checked">
                <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 'var(--xc-space-2)', margin: 0 }}>
                    <ContractConsentPanel manifest={{ status: 'unavailable' }} />
                </dl>
            </LiveExample>
            <LiveExample label="Owner withdraw warning">
                <OwnerWithdrawWarning ownerWithdraw />
            </LiveExample>
        </Section>
    );
}
