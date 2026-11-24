// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ActionConfirmScreen } from '@xchain-wallet/core/shared/components/ActionConfirmScreen.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { PartsExampleProvider, PART_ADDRESS, PART_CHAIN_ID } from './partsExamples.jsx';

const noop = () => {};

const CONFIRM_ACTION = Object.freeze({
    phase: 'ready',
    composed: {
        chainId: PART_CHAIN_ID,
        networkFeeSats: 1200,
        decoded: {
            summary: 'Send 0.01 BTC',
            details: [
                { label: 'Amount', value: '0.01' },
                { label: 'Token', value: 'BTC' },
                { label: 'To', value: PART_ADDRESS },
            ],
            warnings: [],
        },
    },
    report: null,
    acknowledged: false,
    acknowledge: noop,
    canApprove: true,
    approve: noop,
    reject: noop,
    error: null,
    source: PART_ADDRESS,
});

export function ActionConfirmSection() {
    const [password, setPassword] = useState('');
    return (
        <Section
            id="action-confirm"
            title="Action confirm"
            tag="CANONICAL · ActionConfirmScreen"
            kicker="The review step every signed action ends on: what will happen, who signs, the network fee, and the credentials gate, in one screen. Every signed action reaches it through the same component."
        >
            <Guidance
                what={<><code>&lt;ActionConfirmScreen confirmAction chainLabel password onPasswordChange signerReady /&gt;</code> from <code>@xchain-wallet/core/shared/components/</code>. It reads the decoded action from <code>confirmAction</code>, shows the exact network fee when the composed transaction knows it, and swaps the password field for the hardware-signer block (<code>HwSignBlock</code>) when the source is a Trezor or Ledger. The review anatomy (summary, rows and learn note) is the shared <code>ConfirmStandard</code> (<code>shared/components/ConfirmStandard.jsx</code>).</>}
                when={<>The review stage of every form that signs and broadcasts an action: send, token actions, market orders, contract calls.</>}
                whenNot={<>Result screens (use the result panels) · a yes / no question that signs nothing (ConfirmModal).</>}
                doRule={<>✓ Pass the form's own extra gates through <code>extraCredentials</code> · keep Approve disabled until the credentials gate is complete</>}
                dontRule={<>✗ Roll a second review layout in a form · show a fee estimate as if it were the exact fee</>}
                supersedes={<>Per-form review stages. Source: <code>packages/core/src/shared/components/ActionConfirmScreen.jsx</code>.</>}
            />
            <Markup>
{`<ActionConfirmScreen
    confirmAction={confirmAction}
    chainLabel="Bitcoin"
    signerReady={false}
    password={password}
    onPasswordChange={setPassword}
/>`}
            </Markup>
            <LiveExample label="Review with a password gate" minHeight={620} padded={false}>
                <PartsExampleProvider>
                    <ActionConfirmScreen
                        confirmAction={CONFIRM_ACTION}
                        screenVariant="small"
                        chainLabel="Bitcoin"
                        chainId={PART_CHAIN_ID}
                        coinTicker="BTC"
                        signerReady={false}
                        password={password}
                        onPasswordChange={setPassword}
                    />
                </PartsExampleProvider>
            </LiveExample>
        </Section>
    );
}
