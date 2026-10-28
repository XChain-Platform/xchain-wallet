// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ActionConfirmScreen } from '@xchain-wallet/core/shared/components/ActionConfirmScreen.jsx';
import { SignCredentials } from '@xchain-wallet/core/shared/components/SignCredentials.jsx';
import { ContractConsentPanel } from '@xchain-wallet/core/shared/components/ContractConsentPanel.jsx';
import { OwnerWithdrawWarning } from '@xchain-wallet/core/shared/components/OwnerWithdrawWarning.jsx';
import { DemoExitConfirm } from '@xchain-wallet/core/shared/components/DemoExitConfirm.jsx';
import { DraftDiscardButton } from '@xchain-wallet/core/shared/components/DraftDiscardButton.jsx';
import { NativeFeeToggle } from '@xchain-wallet/core/shared/components/NativeFeeToggle.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { PartsExampleProvider, PART_ADDRESS, PART_CHAIN_ID } from './partsExamples.jsx';

const noop = () => {};
const DIALOG_H = 320;

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
            kicker="The review step every signed action ends on: what will happen, who signs, the network fee, and the credentials gate, in one screen. Fifty-six screens reach it through the same component."
        >
            <Guidance
                what={<><code>&lt;ActionConfirmScreen confirmAction chainLabel password onPasswordChange signerReady /&gt;</code> from <code>@xchain-wallet/core/shared/components/</code>. It reads the decoded action from <code>confirmAction</code>, shows the exact network fee when the composed transaction knows it, and swaps the password field for the hardware-signer block when the source is a Trezor or Ledger.</>}
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

export function SignCredentialsSection() {
    const [password, setPassword] = useState('');
    return (
        <Section
            id="sign-credentials"
            title="Sign credentials"
            tag="CANONICAL · SignCredentials"
            kicker="The credentials half of a signing form: a note when the wallet is already unlocked, the password field when it is not, and the device block for a hardware signer."
        >
            <Guidance
                what={<><code>&lt;SignCredentials fromAddress chainId password onPasswordChange unlocked /&gt;</code>. A software address with an unlocked session shows a short note; a locked one shows the password field; a Trezor or Ledger address shows the device status block.</>}
                when={<>Inside a form that signs without the shared review screen.</>}
                whenNot={<>Forms that already end on the action review screen; it renders this itself.</>}
                doRule={<>✓ Pass the whole address record so the hardware branch can read its signer</>}
                dontRule={<>✗ Draw a bare password input for signing</>}
                supersedes={<>Per-form password fields. Source: <code>packages/core/src/shared/components/SignCredentials.jsx</code>.</>}
            />
            <Markup>
{`<SignCredentials
    fromAddress={fromAddress}
    chainId={chainId}
    password={password}
    onPasswordChange={setPassword}
    unlocked={false}
/>`}
            </Markup>
            <LiveExample label="Locked software wallet: password field">
                <PartsExampleProvider>
                    <SignCredentials
                        fromAddress={{ address: PART_ADDRESS, source: 'software' }}
                        chainId={PART_CHAIN_ID}
                        password={password}
                        onPasswordChange={setPassword}
                        unlocked={false}
                    />
                </PartsExampleProvider>
            </LiveExample>
            <LiveExample label="Unlocked session: note only">
                <PartsExampleProvider>
                    <SignCredentials
                        fromAddress={{ address: PART_ADDRESS, source: 'software' }}
                        chainId={PART_CHAIN_ID}
                        password=""
                        onPasswordChange={noop}
                        unlocked
                    />
                </PartsExampleProvider>
            </LiveExample>
        </Section>
    );
}

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

export function DraftAndExitSection() {
    return (
        <Section
            id="draft-exit"
            title="Draft discard and demo exit"
            tag="CANONICAL · DraftDiscardButton / DemoExitConfirm"
            kicker="The two ways out of unfinished or sample state: a link-style button that drops a saved draft, and the destructive confirmation that deletes the demo wallet."
        >
            <Guidance
                what={<><code>DraftDiscardButton</code> is a small <code>Button variant="link"</code> with a caller-supplied accessible label. <code>DemoExitConfirm</code> is a danger <code>ConfirmModal</code> whose message states what is deleted and what is not.</>}
                when={<>Draft: a form that restored saved input. Demo exit: every user-triggered way out of the demo wallet.</>}
                whenNot={<>Real wallets: removing one is its own flow with a recovery check.</>}
                doRule={<>✓ Reuse the shared demo message so every exit says the same thing</>}
                dontRule={<>✗ Discard a draft without a visible control</>}
                supersedes={<>Source: <code>DraftDiscardButton.jsx</code>, <code>DemoExitConfirm.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<DraftDiscardButton onClick={discard} label="Discard the saved draft">Discard draft</DraftDiscardButton>
<DemoExitConfirm busy={false} error={null} onConfirm={exit} onCancel={stay} />`}
            </Markup>
            <LiveExample label="DraftDiscardButton">
                <DraftDiscardButton onClick={noop} label="Discard the saved draft">Discard draft</DraftDiscardButton>
            </LiveExample>
            <LiveExample label="DemoExitConfirm" minHeight={DIALOG_H + 120} padded={false}>
                <DemoExitConfirm busy={false} error={null} onConfirm={noop} onCancel={noop} />
            </LiveExample>
        </Section>
    );
}

export function NativeFeeToggleSection() {
    const [on, setOn] = useState(true);
    return (
        <Section
            id="native-fee-toggle"
            title="Protocol fee toggle"
            tag="CANONICAL · NativeFeeToggle"
            kicker="The row on an action form that chooses how the protocol fee is paid: as the coin equivalent on chain, or from the token balance."
        >
            <Guidance
                what={<><code>&lt;NativeFeeToggle checked onChange coinTicker mandatory unverified fee /&gt;</code>. A choice renders a switch row; a chain with no choice, or an action whose fee is zero, renders a plain statement row on the same card.</>}
                when={<>Forms for actions that carry a protocol fee, below the amount fields.</>}
                whenNot={<>Plain coin sends: they have no protocol fee.</>}
                doRule={<>✓ Pass <code>mandatory</code> when the chain gives no choice</>}
                dontRule={<>✗ Hide the row when the fee is zero (the statement row says so)</>}
                supersedes={<>Source: <code>NativeFeeToggle.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<NativeFeeToggle checked={on} onChange={setOn} coinTicker="BTC" />`}
            </Markup>
            <LiveExample label="Choice (Bitcoin)">
                <NativeFeeToggle checked={on} onChange={setOn} coinTicker="BTC" />
            </LiveExample>
            <LiveExample label="No choice (mandatory)">
                <NativeFeeToggle checked onChange={noop} coinTicker="LTC" mandatory />
            </LiveExample>
        </Section>
    );
}

