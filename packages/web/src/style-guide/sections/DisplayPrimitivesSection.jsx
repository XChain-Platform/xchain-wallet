// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    AddressText,
    ChainBadge,
    CopyButton,
    InfoTip,
    MultisigBadge,
    VerifiedBadge,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

const registry = registryLib.defaultRegistry();
const bitcoin = registry.get('bitcoin-mainnet');
const bitcoinTestnet = registry.get('bitcoin-testnet');
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

const rowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
};

export function ChainBadgeSection() {
    return (
        <Section id="chain-badge" title="Chain badge" tag="PRIMITIVE" kicker="Compact, read-only chain identity for summaries, lists, and review rows.">
            <Guidance
                what={<>The chain icon and display name in a descriptor-colored pill, with a visible testnet or regtest qualifier when applicable.</>}
                when={<>Use where the chain is fixed and the user is reviewing or scanning data.</>}
                whenNot={<>Use <code>ChainPicker</code> or <code>NetworkField</code> when the user can change the network.</>}
                sizing={<><code>sm</code> fits list rows; <code>md</code> fits details and review summaries.</>}
                variants={<>Name and network-kind visibility can be disabled for tightly constrained icon-only layouts.</>}
                doRule={<>Pass the registry descriptor so color, icon, and network naming stay canonical.</>}
                dontRule={<>Do not substitute a badge for an editable chain field.</>}
            />
            <Markup>
{`import { ChainBadge } from '@xchain-wallet/core/ui';

<ChainBadge descriptor={chainRegistry.get(chainId)} size="sm" />`}
            </Markup>
            <LiveExample label="Mainnet and testnet remain distinguishable at a glance.">
                <div style={rowStyle}>
                    <ChainBadge descriptor={bitcoin} size="sm" />
                    <ChainBadge descriptor={bitcoinTestnet} size="md" />
                    <ChainBadge
                        descriptor={bitcoinTestnet}
                        showName={false}
                        showNetworkKind={false}
                    />
                </div>
            </LiveExample>
        </Section>
    );
}

export function AddressTextSection() {
    return (
        <Section id="address-text" title="Address text" tag="PRIMITIVE" kicker="A readable, copy-adjacent display treatment for long blockchain addresses.">
            <Guidance
                what={<>Monospace address text with safe middle truncation and optional positional highlighting.</>}
                when={<>Use for non-editable addresses in lists, details, confirmations, and receive surfaces.</>}
                whenNot={<>Use <code>Input</code>, <code>AddressField</code>, or <code>AddressCombobox</code> when the value is editable.</>}
                sizing={<><code>sm</code> for dense rows and <code>md</code> for primary details.</>}
                variants={<>Truncated or full, plain or highlighted head and tail.</>}
                doRule={<>Keep the complete address in the accessible name and title even when the visible middle is elided.</>}
                dontRule={<>Do not hand-truncate an address in route code.</>}
            />
            <Markup>
{`import { AddressText } from '@xchain-wallet/core/ui';

<AddressText address={address} highlight />`}
            </Markup>
            <LiveExample label="Plain, highlighted, and full address treatments.">
                <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start' }}>
                    <AddressText address={ADDRESS} />
                    <AddressText address={ADDRESS} highlight />
                    <AddressText address={ADDRESS} truncate={false} size="sm" />
                </div>
            </LiveExample>
        </Section>
    );
}

export function CopyButtonSection() {
    return (
        <Section id="copy-button" title="Copy button" tag="PRIMITIVE" kicker="The single clipboard path, with explicit success and failure feedback.">
            <Guidance
                what={<>A text-and-icon button that copies through the shared clipboard policy and briefly reports the outcome.</>}
                when={<>Use beside addresses, transaction IDs, signatures, and other values users need elsewhere.</>}
                whenNot={<>Do not offer copying when the surrounding flow can pass the value directly.</>}
                sizing={<>Content-sized and suitable for an inline detail row or compact action group.</>}
                variants={<>Custom label, accessible label, feedback duration, and sensitive clipboard handling.</>}
                doRule={<>Set <code>sensitive</code> for seed words and private keys so native clipboard policy is enforced.</>}
                dontRule={<>Do not call <code>navigator.clipboard</code> directly from a route.</>}
            />
            <Markup>
{`import { CopyButton } from '@xchain-wallet/core/ui';

<CopyButton value={address} label="Copy address" />`}
            </Markup>
            <LiveExample label="Copy feedback is announced and returns to idle automatically.">
                <CopyButton value={ADDRESS} label="Copy address" />
            </LiveExample>
        </Section>
    );
}

export function MultisigBadgeSection() {
    return (
        <Section id="multisig-badge" title="Multisig badge" tag="PRIMITIVE" kicker="Compact signing-threshold and script-family identity for multisig accounts and transactions.">
            <Guidance
                what={<>A threshold badge that combines plain-language scheme names with protocol detail in its accessible label and title.</>}
                when={<>Use anywhere a multisig address, account, or signing session appears.</>}
                whenNot={<>Do not show it for single-key accounts or use it as the signing-progress indicator.</>}
                sizing={<><code>sm</code> for rows and <code>md</code> for primary account details.</>}
                variants={<>Classic, SegWit, and Taproot scheme tones.</>}
                doRule={<>Pass the persisted multisig threshold, cosigner count, and scheme without relabeling them.</>}
                dontRule={<>Do not expose only P2SH, P2WSH, or MuSig2 jargon as the visible label.</>}
            />
            <Markup>
{`import { MultisigBadge } from '@xchain-wallet/core/ui';

<MultisigBadge threshold={2} cosignerCount={3} scheme="p2wsh-multisig" />`}
            </Markup>
            <LiveExample label="Scheme families use distinct tones while keeping the threshold first.">
                <div style={rowStyle}>
                    <MultisigBadge threshold={2} cosignerCount={3} scheme="p2sh-multisig" size="sm" />
                    <MultisigBadge threshold={2} cosignerCount={3} scheme="p2wsh-multisig" />
                    <MultisigBadge threshold={3} cosignerCount={5} scheme="taproot-musig2" />
                </div>
            </LiveExample>
        </Section>
    );
}

export function VerifiedBadgeSection() {
    return (
        <Section id="verified-badge" title="Verified badge" tag="PRIMITIVE" kicker="A proof verdict for values checked independently against the network record.">
            <Guidance
                what={<>A compact status badge for verified, failed, unavailable, and in-progress proof checks.</>}
                when={<>Use next to balances or actions whose light-client proof status matters.</>}
                whenNot={<>Do not attach it to native-coin values that have no XChain state-tree proof.</>}
                sizing={<><code>sm</code> for rows and <code>md</code> for detail views.</>}
                variants={<>Verified, proof failed, unverified, and verifying.</>}
                doRule={<>Pass known reason codes so the title can explain unavailable and failed states in plain words.</>}
                dontRule={<>Do not turn a failed proof into a neutral loading or informational status.</>}
            />
            <Markup>
{`import { VerifiedBadge } from '@xchain-wallet/core/ui';

<VerifiedBadge status={proof.status} reason={proof.reason} />`}
            </Markup>
            <LiveExample label="All proof states use stable words and tones.">
                <div style={rowStyle}>
                    <VerifiedBadge status="verified" />
                    <VerifiedBadge status="failed" reason="CHECKPOINT_QUORUM_FAILED" />
                    <VerifiedBadge status="unavailable" reason="NOT_YET_CHECKPOINTED" />
                    <VerifiedBadge status="pending" size="md" />
                </div>
            </LiveExample>
        </Section>
    );
}

export function InfoTipSection() {
    return (
        <Section id="info-tip" title="Info tip" tag="PRIMITIVE" kicker="Optional contextual help for an unfamiliar term without taking permanent form space.">
            <Guidance
                what={<>A keyboard-reachable help trigger whose tooltip re-anchors to remain inside narrow viewports.</>}
                when={<>Use for concise explanations of fee tiers, derivation paths, RBF, and other unfamiliar terms.</>}
                whenNot={<>Keep required instructions and error recovery inline where users cannot miss them.</>}
                sizing={<>The visible dot is 16px and the interactive target meets the shared tap minimum.</>}
                variants={<>Top or bottom placement and a custom accessible trigger label.</>}
                doRule={<>Write one short explanation that makes sense without protocol documentation.</>}
                dontRule={<>Do not hide required consent, risk, or recovery instructions in a tooltip.</>}
            />
            <Markup>
{`import { InfoTip } from '@xchain-wallet/core/ui';

<span>
    Replace-by-fee
    <InfoTip label="Lets you raise the fee while a payment is pending." />
</span>`}
            </Markup>
            <LiveExample label="Hover, focus, or press the help trigger.">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <p style={{ margin: 0 }}>
                        Replace-by-fee
                        <InfoTip label="Lets you raise the fee while a payment is pending." />
                    </p>
                    <p style={{ margin: 0 }}>
                        Derivation path
                        <InfoTip
                            placement="bottom"
                            aria="About derivation paths"
                            label="Identifies where this account sits in the wallet key tree."
                        />
                    </p>
                </div>
            </LiveExample>
        </Section>
    );
}
